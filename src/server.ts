import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { formatEvent, type EventHub } from './events.js'
import { englishOf, fail, noticeOf, type NoticeCode } from './notice/notice.js'
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
import type { Calibration } from './stats/calibration.js'
import type { CheckpointThreshold, SessionCheckpoint } from './stats/checkpoint.js'
import type { StatsSteps } from './stats/steps.js'
import type { TaskCard } from './tracker/card.js'
import type { TaskFile } from './tracker/source.js'

/** Files the browser may show in place; anything else is a download, so a tracker file never runs as the page. */
const SHOWN_IN_PLACE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf)$/

export interface StatsSource {
  history(filter: StatsFilter): Promise<StatsAnswer<StatsHistory>>
  period(query: PeriodQuery): Promise<StatsAnswer<StatsPeriod>>
  steps(query: PeriodQuery): Promise<StatsAnswer<StatsSteps>>
  task(task: string): Promise<StatsAnswer<StatsTaskDetail>>
  calibration(project: string, task: string | null): Promise<StatsAnswer<Calibration>>
  checkpoints(): Promise<StatsAnswer<CheckpointThreshold[]>>
  rules(query: RulesQuery): Promise<StatsAnswer<StatsRules>>
  ruleDiff(ids: string[]): Promise<StatsAnswer<RuleDiffFile[]>>
  compare(query: CompareQuery): Promise<StatsAnswer<StatsCompare>>
}

export interface ChainControl {
  start(project: string): void
  resume(project: string): void
  stop(project: string): void
  dequeue(project: string): void
  reorder(project: string, order: string[]): void
  requeue(order: string[]): void
  skip(project: string, task: string): void
  unskip(project: string, task: string): void
  restart(project: string, task: string): void
  dismiss(project: string, task: string): void
  setUnattended(on: boolean): void
  setTrimTools(on: boolean): void
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

export interface TaskControl {
  /** `undefined` — no connected tracker gives a card for the task. */
  card(task: string): Promise<TaskCard | undefined>
  /** `undefined` — no connected tracker gives the file, or the task has no such file. */
  file(task: string, file: string): Promise<TaskFile | undefined>
  ready(task: string): Promise<void>
}

export interface AnswerRequest {
  project: string
  task: string
  sessionId: string
  /** The id of the `AskUserQuestion` answered; `null` — a reply to a turn that ended in plain text. */
  ask: string | null
  answers: Record<string, string>
  text: string
  files: { name: string; data: Uint8Array }[]
}

export interface SessionControl {
  answer(request: AnswerRequest): Promise<void>
}

export interface ServerDeps {
  hub: EventHub
  publicDir: string
  getState: () => unknown
  control: ChainControl
  account: AccountControl
  sessions: SessionControl
  launches: () => unknown
  sessionRecord: (sessionId: string) => Promise<unknown>
  /** Lines of the whole transcript from index `after` on. */
  transcript: (sessionId: string, after: number) => Promise<unknown>
  /** For the checkpoint hook; `undefined` for a session the chain did not start. */
  checkpoint: (sessionId: string) => Promise<SessionCheckpoint | undefined>
  /** `undefined` for a project the config does not know. */
  tools: (project: string) => Promise<unknown>
  tasks: TaskControl
  stats: StatsSource
}

type Command = (deps: ServerDeps, body: Record<string, unknown>) => void | Promise<void>

const COMMANDS: Record<string, Command> = {
  'chain/start': ({ control }, body) => control.start(projectOf(body)),
  'chain/resume': ({ control }, body) => control.resume(projectOf(body)),
  'chain/stop': ({ control }, body) => control.stop(projectOf(body)),
  'chain/dequeue': ({ control }, body) => control.dequeue(projectOf(body)),
  'chain/order': ({ control }, body) => control.reorder(projectOf(body), listOf(body, 'request.taskList')),
  'chain/queue': ({ control }, body) => control.requeue(listOf(body, 'request.projectList')),
  'chain/skip': ({ control }, body) => control.skip(projectOf(body), taskOf(body)),
  'chain/unskip': ({ control }, body) => control.unskip(projectOf(body), taskOf(body)),
  'chain/restart': ({ control }, body) => control.restart(projectOf(body), taskOf(body)),
  'chain/dismiss': ({ control }, body) => control.dismiss(projectOf(body), taskOf(body)),
  'chain/unattended': ({ control }, body) => control.setUnattended(flagOf(body)),
  'chain/trim': ({ control }, body) => control.setTrimTools(flagOf(body)),
  'task/ready': ({ tasks }, body) => tasks.ready(taskOf(body)),
  'session/answer': ({ sessions }, body) => sessions.answer(answerOf(body)),
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
/** An answer carries its files in base64. */
const MAX_ANSWER_BYTES = 64 * 1024 * 1024
const BODY_LIMITS: Record<string, number> = { '/api/session/answer': MAX_ANSWER_BYTES }

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

export function createEvenKeelServer(deps: ServerDeps): Server {
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

  const checkpoint = /^\/api\/sessions\/([^/]+)\/checkpoint$/.exec(path)
  if (request.method === 'GET' && checkpoint !== null) {
    const found = await deps.checkpoint(decodeURIComponent(checkpoint[1]!))
    if (found === undefined) response.writeHead(404).end()
    else sendJson(response, 200, found)
    return
  }

  const session = /^\/api\/sessions\/([^/]+)(\/transcript)?$/.exec(path)
  if (request.method === 'GET' && session !== null) {
    const id = decodeURIComponent(session[1]!)
    const after = Math.max(0, Number.parseInt(url.searchParams.get('after') ?? '', 10) || 0)
    let record: unknown
    try {
      record = await (session[2] === undefined ? deps.sessionRecord(id) : deps.transcript(id, after))
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (record === undefined) response.writeHead(404).end()
    else sendJson(response, 200, record)
    return
  }

  const tools = /^\/api\/projects\/([^/]+)\/tools$/.exec(path)
  if (request.method === 'GET' && tools !== null) {
    let view: unknown
    try {
      view = await deps.tools(decodeURIComponent(tools[1]!))
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (view === undefined) response.writeHead(404).end()
    else sendJson(response, 200, view)
    return
  }

  const calibration = /^\/api\/projects\/([A-Z][A-Z0-9]*)\/calibration$/.exec(path)
  if (request.method === 'GET' && calibration !== null) {
    const task = url.searchParams.get('task')
    if (task !== null && !isTaskId(task)) {
      sendFailure(response, fail('request.taskId', {}))
      return
    }
    sendJson(response, 200, await deps.stats.calibration(calibration[1]!, task))
    return
  }

  const card = /^\/api\/tasks\/([^/]+)$/.exec(path)
  if (request.method === 'GET' && card !== null) {
    let view: TaskCard | undefined
    try {
      const task = decodeURIComponent(card[1]!)
      if (!isTaskId(task)) throw fail('request.taskId', {})
      view = await deps.tasks.card(task)
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (view === undefined) response.writeHead(404).end()
    else sendJson(response, 200, view)
    return
  }

  const file = /^\/api\/tasks\/([^/]+)\/files\/([^/]+)$/.exec(path)
  if (request.method === 'GET' && file !== null) {
    let found: TaskFile | undefined
    try {
      const task = decodeURIComponent(file[1]!)
      if (!isTaskId(task)) throw fail('request.taskId', {})
      found = await deps.tasks.file(task, decodeURIComponent(file[2]!))
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (found === undefined) response.writeHead(404).end()
    else await sendFile(response, found)
    return
  }

  const stats = /^\/api\/stats\/(history|period|steps|checkpoints|rules|rules\/diff|rules\/compare|task\/([^/]+))$/.exec(path)
  if (request.method === 'GET' && stats !== null) {
    let read: () => Promise<StatsAnswer<unknown>>
    try {
      if (stats[1] === 'history') {
        const filter = parseStatsFilter(url.searchParams)
        read = () => deps.stats.history(filter)
      } else if (stats[1] === 'period') {
        const query = parsePeriodQuery(url.searchParams)
        read = () => deps.stats.period(query)
      } else if (stats[1] === 'steps') {
        const query = parsePeriodQuery(url.searchParams)
        read = () => deps.stats.steps(query)
      } else if (stats[1] === 'checkpoints') {
        read = () => deps.stats.checkpoints()
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
        if (!isTaskId(task)) throw fail('request.taskId', {})
        read = () => deps.stats.task(task)
      }
    } catch (error) {
      sendFailure(response, error)
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
      const body = await readJsonBody(request, BODY_LIMITS[path] ?? MAX_BODY_BYTES)
      await command(deps, body)
      if (path.startsWith('/api/chain/') || path === '/api/session/answer') {
        console.log(`page: ${path.slice('/api/'.length)} ${commandTarget(body)}`.trimEnd())
      }
    } catch (error) {
      sendFailure(response, error)
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

// `error` stays for scripts; the page translates `notice`.
function sendFailure(response: ServerResponse, error: unknown): void {
  const notice = noticeOf(error)
  sendJson(response, 400, { error: englishOf(notice), notice })
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function sendFile(response: ServerResponse, file: TaskFile): Promise<void> {
  const shown = SHOWN_IN_PLACE.test(file.type)
  response.writeHead(200, {
    'content-type': file.type || 'application/octet-stream',
    ...(file.size === null ? {} : { 'content-length': String(file.size) }),
    'content-disposition': shown ? 'inline' : 'attachment',
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=3600',
    ...(shown ? {} : { 'content-security-policy': 'sandbox' }),
  })
  try {
    await pipeline(Readable.from(file.body), response)
  } catch {
    response.destroy()
  }
}

async function readJsonBody(request: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw fail('request.tooLarge', {})
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw fail('request.notJson', {})
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw fail('request.notObject', {})
  return body as Record<string, unknown>
}

function projectOf(body: Record<string, unknown>): string {
  if (typeof body.project !== 'string' || body.project === '') throw fail('request.required', { field: 'project' })
  return body.project
}

/** What a chain command was aimed at, for the service log: `project/task`, the order, or the switch. */
function commandTarget(body: Record<string, unknown>): string {
  const parts = [body.project, body.task].filter((part) => typeof part === 'string' && part !== '')
  if (Array.isArray(body.order)) parts.push(body.order.join(','))
  if (typeof body.on === 'boolean') parts.push(body.on ? 'on' : 'off')
  return parts.join('/')
}

function flagOf(body: Record<string, unknown>): boolean {
  if (typeof body.on !== 'boolean') throw fail('request.required', { field: 'on' })
  return body.on
}

function taskOf(body: Record<string, unknown>): string {
  if (typeof body.task !== 'string' || body.task === '') throw fail('request.required', { field: 'task' })
  return body.task
}

export function answerOf(body: Record<string, unknown>): AnswerRequest {
  const { sessionId, ask, answers, text, files } = body
  if (typeof sessionId !== 'string' || sessionId === '') throw fail('request.required', { field: 'sessionId' })
  if (ask !== null && (typeof ask !== 'string' || ask === '')) throw fail('request.required', { field: 'ask' })
  const answered = typeof answers === 'object' && answers !== null && !Array.isArray(answers) ? Object.entries(answers) : []
  const sent = Array.isArray(files) ? files : []
  if (!answered.every(([, value]) => typeof value === 'string')) throw fail('request.required', { field: 'answers' })
  if (!sent.every((file) => typeof file?.name === 'string' && typeof file?.data === 'string')) throw fail('request.required', { field: 'files' })
  return {
    project: projectOf(body),
    task: taskOf(body),
    sessionId,
    ask,
    answers: Object.fromEntries(answered) as Record<string, string>,
    text: typeof text === 'string' ? text : '',
    files: sent.map((file: { name: string; data: string }) => ({ name: file.name, data: Buffer.from(file.data, 'base64') })),
  }
}

function accountOf(body: Record<string, unknown>): string {
  if (typeof body.account !== 'string' || body.account === '') throw fail('request.required', { field: 'account' })
  return body.account
}

function appOf(body: Record<string, unknown>): string {
  if (typeof body.app !== 'string' || body.app === '') throw fail('request.required', { field: 'app' })
  return body.app
}

function codeOf(body: Record<string, unknown>): string {
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (code === '') throw fail('request.required', { field: 'code' })
  return code
}

function listOf(body: Record<string, unknown>, code: Extract<NoticeCode, 'request.taskList' | 'request.projectList'>): string[] {
  const { order } = body
  if (!Array.isArray(order) || !order.every((item) => typeof item === 'string')) throw fail(code, {})
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
