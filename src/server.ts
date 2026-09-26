import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { formatEvent, type EventHub } from './events.js'

export interface ChainControl {
  start(project: string): void
  pause(): void
  resume(): void
  stop(): void
  dequeue(project: string): void
  reorder(project: string, order: string[]): void
}

export interface ServerDeps {
  hub: EventHub
  publicDir: string
  getState: () => unknown
  control: ChainControl
  launches: () => unknown
}

type Command = (control: ChainControl, body: Record<string, unknown>) => void

const COMMANDS: Record<string, Command> = {
  start: (control, body) => control.start(projectOf(body)),
  pause: (control) => control.pause(),
  resume: (control) => control.resume(),
  stop: (control) => control.stop(),
  dequeue: (control, body) => control.dequeue(projectOf(body)),
  order: (control, body) => {
    const { order } = body
    if (!Array.isArray(order) || !order.every((id) => typeof id === 'string')) {
      throw new Error('order must be a list of task ids')
    }
    control.reorder(projectOf(body), order)
  },
}

const MAX_BODY_BYTES = 64 * 1024

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

export function createBatonServer(deps: ServerDeps): Server {
  return createServer((request, response) => {
    route(deps, request, response).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(String(error))
    })
  })
}

async function route(deps: ServerDeps, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname

  if (request.method === 'GET' && path === '/api/state') {
    sendJson(response, 200, deps.getState())
    return
  }

  if (request.method === 'GET' && path === '/api/launches') {
    sendJson(response, 200, deps.launches())
    return
  }

  if (request.method === 'POST' && path.startsWith('/api/chain/')) {
    const command = COMMANDS[path.slice('/api/chain/'.length)]
    if (command === undefined) {
      response.writeHead(404).end()
      return
    }
    try {
      command(deps.control, await readJsonBody(request))
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      return
    }
    sendJson(response, 200, deps.getState())
    return
  }

  if (request.method === 'GET' && path === '/api/events') {
    streamEvents(deps, request, response)
    return
  }

  if (request.method === 'GET') {
    await serveStatic(deps.publicDir, path, response)
    return
  }

  response.writeHead(405).end()
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('request body is not JSON')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('request body must be an object')
  return body as Record<string, unknown>
}

function projectOf(body: Record<string, unknown>): string {
  if (typeof body.project !== 'string' || body.project === '') throw new Error('project is required')
  return body.project
}

function streamEvents(deps: ServerDeps, request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  response.write(formatEvent('state', deps.getState()))
  const unsubscribe = deps.hub.subscribe((frame) => response.write(frame))
  request.on('close', unsubscribe)
}

async function serveStatic(publicDir: string, path: string, response: ServerResponse): Promise<void> {
  const root = normalize(publicDir + sep)
  const file = normalize(join(root, decodeURIComponent(path === '/' ? '/index.html' : path)))
  if (!file.startsWith(root)) {
    response.writeHead(404).end()
    return
  }
  try {
    const body = await readFile(file)
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404).end()
  }
}
