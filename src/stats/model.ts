export type StatsScope = 'all' | 'chain'

export interface StatsFilter {
  scope: StatsScope
  account: string | null
  tz: string
}

export interface PeriodQuery extends StatsFilter {
  from: string
  to: string
  projects: string[] | null
}

export type StatsCell = [day: number, project: number, cost: number, sessions: number, limit: number]

export interface StatsHistory {
  at: string
  accounts: string[]
  baton: string[]
  projects: string[]
  days: string[]
  cells: StatsCell[]
}

export interface StatsTotals {
  cost: number
  messages: number
  sessions: number
  tasks: number
  unpriced: number
  limit: number | null
  stuckCost: number
}

export interface StatsShare {
  key: string
  cost: number
}

export interface StatsTaskRow {
  task: string
  project: string
  title: string | null
  status: string | null
  cost: number
  limit: number | null
  sessions: number
  relays: number
  checkpoints: number
  restarts: number
  spans: number
  rework: boolean
}

export interface StatsStuck {
  id: string
  task: string | null
  project: string | null
  sessionId: string
  fromAt: string
  toAt: string
  kinds: string[]
  reason: string | null
  note: string | null
}

export interface StatsWeekReason {
  week: string
  reason: string | null
  spans: number
}

export interface StatsPeriod {
  query: PeriodQuery
  at: string
  current: StatsTotals
  previous: StatsTotals
  models: StatsShare[]
  entrypoints: StatsShare[]
  tasks: StatsTaskRow[]
  weeks: StatsWeekReason[]
  stuck: StatsStuck[]
}

export interface StatsTaskSession {
  sessionId: string
  title: string | null
  reason: string | null
  model: string | null
  firstAt: string
  lastAt: string
  cost: number
}

export interface StatsTaskDetail {
  task: string
  sessions: StatsTaskSession[]
  spans: StatsStuck[]
}

export type StatsAnswer<T> = { state: 'ok'; data: T } | { state: 'off'; reason: string } | { state: 'error'; error: string }

export interface ReaderSettings {
  host: string
  port: number
  database: string
  user: string
  password: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const ZONE = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/
const TASK = /^[A-Z][A-Z0-9]*-\d+$/

export function parseStatsFilter(params: URLSearchParams): StatsFilter {
  const scope = params.get('scope') ?? 'all'
  if (scope !== 'all' && scope !== 'chain') throw new Error('scope must be all or chain')
  const account = params.get('account') || null
  const tz = params.get('tz') || 'UTC'
  if (!ZONE.test(tz)) throw new Error('tz must be a time zone name')
  return { scope, account, tz }
}

export function parsePeriodQuery(params: URLSearchParams): PeriodQuery {
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  if (!isDay(from) || !isDay(to)) throw new Error('from and to must be dates YYYY-MM-DD')
  if (from > to) throw new Error('from must not be after to')
  const listed = params.get('projects')
  const projects = listed === null ? null : listed.split(',').filter((each) => each !== '')
  return { ...parseStatsFilter(params), from, to, projects }
}

export function isTaskId(task: string): boolean {
  return TASK.test(task)
}

function isDay(text: string): boolean {
  if (!DAY.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text)
}

export function repoTail(repo: string): string {
  return repo
    .replaceAll('\\', '/')
    .replace(/^[a-z]:/i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

export function readerSettings(env: Record<string, string | undefined>): ReaderSettings | string {
  const missing = ['TALLY_DB_HOST', 'TALLY_DB_NAME', 'TALLY_READER_PASSWORD'].filter((name) => !env[name])
  if (missing.length > 0) return missing.join(', ')
  return {
    host: env.TALLY_DB_HOST!,
    port: Number(env.TALLY_DB_PORT || 5432),
    database: env.TALLY_DB_NAME!,
    user: env.TALLY_READER_USER || 'tally_reader',
    password: env.TALLY_READER_PASSWORD!,
  }
}
