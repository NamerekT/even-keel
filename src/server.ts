import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { formatEvent, type EventHub } from './events.js'
import {
  isTaskId,
  parsePeriodQuery,
  parseStatsFilter,
  type PeriodQuery,
  type StatsAnswer,
  type StatsFilter,
  type StatsHistory,
  type StatsPeriod,
  type StatsTaskDetail,
} from './stats/model.js'
import {
  parseChangeIds,
  parseCompareQuery,
  parseRulesQuery,
  type CompareQuery,
  type RuleDiffFile,
  type RulesQuery,
  type StatsCompare,
  type StatsRules,
} from './stats/rules.js'

export interface StatsSource {
  history(filter: StatsFilter): Promise<StatsAnswer<StatsHistory>>
  period(query: PeriodQuery): Promise<StatsAnswer<StatsPeriod>>
  task(task: string): Promise<StatsAnswer<StatsTaskDetail>>
  rules(query: RulesQuery): Promise<StatsAnswer<StatsRules>>
  ruleDiff(ids: string[]): Promise<StatsAnswer<RuleDiffFile[]>>
  compare(query: CompareQuery): Promise<StatsAnswer<StatsCompare>>
}

export interface ChainControl {
  start(project: string): void
  pause(): void
  resume(): void
  stop(): void
  dequeue(project: string): void
  reorder(project: string, order: string[]): void
  requeue(order: string[]): void
  skip(project: string, task: string): void
  unskip(project: string, task: string): void
  restart(project: string, task: string): void
  dismiss(project: string, task: string): void
}

export interface AccountControl {
  add(): void
  renew(account: string): void
  switchTo(account: string): void
  switchApp(app: string, account: string): Promise<void>
  remove(account: string): Promise<void>
  keep(account: string): void
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
  sessionRecord: (sessionId: string) => Promise<unknown>
  stats: StatsSource
}

type Command = (deps: ServerDeps, body: Record<string, unknown>) => void | Promise<void>

const COMMANDS: Record<string, Command> = {
  'chain/start': ({ control }, body) => control.start(projectOf(body)),
  'chain/pause': ({ control }) => control.pause(),
  'chain/resume': ({ control }) => control.resume(),
  'chain/stop': ({ control }) => control.stop(),
  'chain/dequeue': ({ control }, body) => control.dequeue(projectOf(body)),
  'chain/order': ({ control }, body) => control.reorder(projectOf(body), listOf(body, 'order must be a list of task ids')),
  'chain/queue': ({ control }, body) => control.requeue(listOf(body, 'order must be a list of projects')),
  'chain/skip': ({ control }, body) => control.skip(projectOf(body), taskOf(body)),
  'chain/unskip': ({ control }, body) => control.unskip(projectOf(body), taskOf(body)),
  'chain/restart': ({ control }, body) => control.restart(projectOf(body), taskOf(body)),
  'chain/dismiss': ({ control }, body) => control.dismiss(projectOf(body), taskOf(body)),
  'account/add': ({ account }) => account.add(),
  'account/renew': ({ account }, body) => account.renew(accountOf(body)),
  'account/switch': ({ account }, body) => account.switchTo(accountOf(body)),
  'account/app': ({ account }, body) => account.switchApp(appOf(body), accountOf(body)),
  'account/remove': ({ account }, body) => account.remove(accountOf(body)),
  'account/keep': ({ account }, body) => account.keep(accountOf(body)),
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
  const url = new URL(request.url ?? '/', 'http://localhost')
  const path = url.pathname

  if (request.method === 'GET' && path === '/api/state') {
    sendJson(response, 200, deps.getState())
    return
  }

  if (request.method === 'GET' && path === '/api/launches') {
    sendJson(response, 200, deps.launches())
    return
  }

  const session = /^\/api\/sessions\/([^/]+)$/.exec(path)
  if (request.method === 'GET' && session !== null) {
    let record: unknown
    try {
      record = await deps.sessionRecord(decodeURIComponent(session[1]!))
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      return
    }
    if (record === undefined) response.writeHead(404).end()
    else sendJson(response, 200, record)
    return
  }

  const stats = /^\/api\/stats\/(history|period|rules|rules\/diff|rules\/compare|task\/([^/]+))$/.exec(path)
  if (request.method === 'GET' && stats !== null) {
    let read: () => Promise<StatsAnswer<unknown>>
    try {
      if (stats[1] === 'history') {
        const filter = parseStatsFilter(url.searchParams)
        read = () => deps.stats.history(filter)
      } else if (stats[1] === 'period') {
        const query = parsePeriodQuery(url.searchParams)
        read = () => deps.stats.period(query)
      } else if (stats[1] === 'rules') {
        const query = parseRulesQuery(url.searchParams)
        read = () => deps.stats.rules(query)
      } else if (stats[1] === 'rules/diff') {
        const ids = parseChangeIds(url.searchParams)
        read = () => deps.stats.ruleDiff(ids)
      } else if (stats[1] === 'rules/compare') {
        const query = parseCompareQuery(url.searchParams)
        read = () => deps.stats.compare(query)
      } else {
        const task = decodeURIComponent(stats[2]!)
        if (!isTaskId(task)) throw new Error('task must look like ABC-12')
        read = () => deps.stats.task(task)
      }
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      return
    }
    sendJson(response, 200, await read())
    return
  }

  if (request.method === 'POST' && path.startsWith('/api/')) {
    const command = COMMANDS[path.slice('/api/'.length)]
    if (command === undefined) {
      response.writeHead(404).end()
      return
    }
    try {
      await command(deps, await readJsonBody(request))
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

function taskOf(body: Record<string, unknown>): string {
  if (typeof body.task !== 'string' || body.task === '') throw new Error('task is required')
  return body.task
}

function accountOf(body: Record<string, unknown>): string {
  if (typeof body.account !== 'string' || body.account === '') throw new Error('account is required')
  return body.account
}

function appOf(body: Record<string, unknown>): string {
  if (typeof body.app !== 'string' || body.app === '') throw new Error('app is required')
  return body.app
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
