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
  requeue(order: string[]): void
}

export interface AccountControl {
  login(): void
  code(code: string): void
  cancel(): void
}

export interface ServerDeps {
  hub: EventHub
  publicDir: string
  getState: () => unknown
  control: ChainControl
  account: AccountControl
  launches: () => unknown
}

type Command = (deps: ServerDeps, body: Record<string, unknown>) => void

const COMMANDS: Record<string, Command> = {
  'chain/start': ({ control }, body) => control.start(projectOf(body)),
  'chain/pause': ({ control }) => control.pause(),
  'chain/resume': ({ control }) => control.resume(),
  'chain/stop': ({ control }) => control.stop(),
  'chain/dequeue': ({ control }, body) => control.dequeue(projectOf(body)),
  'chain/order': ({ control }, body) => control.reorder(projectOf(body), listOf(body, 'order must be a list of task ids')),
  'chain/queue': ({ control }, body) => control.requeue(listOf(body, 'order must be a list of projects')),
  'account/login': ({ account }) => account.login(),
  'account/code': ({ account }, body) => account.code(codeOf(body)),
  'account/cancel': ({ account }) => account.cancel(),
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

  if (request.method === 'POST' && path.startsWith('/api/')) {
    const command = COMMANDS[path.slice('/api/'.length)]
    if (command === undefined) {
      response.writeHead(404).end()
      return
    }
    try {
      command(deps, await readJsonBody(request))
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

function codeOf(body: Record<string, unknown>): string {
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (code === '') throw new Error('code is required')
  return code
}

function listOf(body: Record<string, unknown>, message: string): string[] {
  const { order } = body
  if (!Array.isArray(order) || !order.every((item) => typeof item === 'string')) throw new Error(message)
  return order
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
  const isClientRoute = !path.startsWith('/api/') && extname(path) === ''
  const file = normalize(join(root, isClientRoute ? 'index.html' : decodeURIComponent(path)))
  if (!file.startsWith(root)) {
    response.writeHead(404).end()
    return
  }
  let body: Buffer
  try {
    body = await readFile(file)
  } catch {
    if (isClientRoute) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('The web client is not built: run npm run build')
      return
    }
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  response.end(body)
}
