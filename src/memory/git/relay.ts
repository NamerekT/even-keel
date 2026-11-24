import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MAX_BODY_BYTES, type GitAnswer, type GitRequest } from '../../link/protocol.js'
import { plainAnswer } from './backend.js'

/** A project's repository in the relay's address: the project's id, as the hub names its `<id>.git`. */
const REPOSITORY = /^\/([A-Za-z0-9_-]+)\.git(\/.*)?$/

/** The base64 of a body this large fills the link's limit; git's own request around it is small. */
const MAX_REQUEST_BYTES = Math.floor((MAX_BODY_BYTES * 3) / 4) - 64 * 1024

export interface MemoryRelayDeps {
  /** The request to the hub over the link; `undefined` — the hub is not reachable now. */
  send(project: string, request: GitRequest): Promise<GitAnswer | undefined>
  log(line: string): void
}

/**
 * A machine's loopback HTTP server that is the `origin` of its memory working copies (BTN-1648, `docs/sessions/memory.md`):
 * each request of git's smart HTTP protocol to `http://127.0.0.1:<port>/<project>.git` goes to the hub over the link
 * (`/link/git`), and the hub's `git http-backend` answers. Without the link git gets 503 and the commits stay local;
 * a push over the link's body limit gets 413, told in the log once per project.
 */
export class MemoryRelay {
  private server: Server | undefined
  private port = 0
  private readonly told = new Set<string>()

  constructor(private readonly deps: MemoryRelayDeps) {}

  async start(): Promise<void> {
    if (this.server !== undefined) return
    const server = createServer((request, response) => void this.answer(request, response))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.server = server
    this.port = (server.address() as AddressInfo).port
  }

  /** The address git reaches the project's repository at; the relay must be started. */
  originOf(project: string): string {
    if (this.server === undefined) throw new Error('the memory relay is not started')
    return `http://127.0.0.1:${this.port}/${project}.git`
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server === undefined) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://relay')
    const match = REPOSITORY.exec(url.pathname)
    if (match === null) return reply(response, plainAnswer(404, 'not a memory repository'))
    const project = match[1]!
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    for await (const chunk of request as AsyncIterable<Buffer>) {
      size += chunk.length
      if (size > MAX_REQUEST_BYTES) over = true
      else chunks.push(chunk)
    }
    if (over) {
      if (!this.told.has(project)) {
        this.told.add(project)
        this.deps.log(`memory: a push of ${project} is ${Math.ceil(size / 1024 / 1024)} MB, over the link's limit: its commits stay on this machine`)
      }
      return reply(response, plainAnswer(413, 'the request is over the link limit'))
    }
    const header = (name: string): string | undefined => {
      const value = request.headers[name]
      return typeof value === 'string' ? value : undefined
    }
    const body = Buffer.concat(chunks)
    const contentType = header('content-type')
    const contentEncoding = header('content-encoding')
    const gitProtocol = header('git-protocol')
    const relayed: GitRequest = {
      method: request.method ?? 'GET',
      path: match[2] ?? '/',
      query: url.search.replace(/^\?/, ''),
      ...(contentType !== undefined && { contentType }),
      ...(contentEncoding !== undefined && { contentEncoding }),
      ...(gitProtocol !== undefined && { gitProtocol }),
      ...(body.length > 0 && { body: body.toString('base64') }),
    }
    let answer: GitAnswer | undefined
    try {
      answer = await this.deps.send(project, relayed)
    } catch (error) {
      this.deps.log(`memory: a git request of ${project} did not get through: ${error instanceof Error ? error.message : String(error)}`)
    }
    reply(response, answer ?? plainAnswer(503, 'the hub is not reachable now'))
  }
}

function reply(response: ServerResponse, answer: GitAnswer): void {
  const body = Buffer.from(answer.body, 'base64')
  response.writeHead(answer.status, { 'Content-Type': answer.contentType, 'Content-Length': body.length, 'Cache-Control': 'no-cache' })
  response.end(body)
}
