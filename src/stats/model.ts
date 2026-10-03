import type { StatsTaskStep } from './steps.js'

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

// Local days, inclusive, from the first to the last snapshot of the weekly limit.
export interface LimitCoverage {
  from: string
  to: string
}

export interface StatsLimitWindow {
  account: string
  resetsAt: string
  peak: number
  open: boolean
}

export interface StatsHistory {
  at: string
  accounts: string[]
  baton: string[]
  projects: string[]
  days: string[]
  cells: StatsCell[]
  limits: LimitCoverage | null
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
  // Times of the whole task (BTN-55), not only of the period; null when the task has no turns yet.
  estimateH: number | null
  activeS: number | null
  waitS: number | null
  totalS: number | null
  done: boolean | null
  component: string | null
  model: string | null
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
  limits: LimitCoverage | null
  windows: StatsLimitWindow[]
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
  steps: StatsTaskStep[]
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

export const SCRATCH_GROUP = 'Scratch приложения'

const SCRATCH = '/claude/scratch-workspaces/'

const holds = (outer: string, inner: string) => inner.startsWith(`${outer}/`)

// Groups the folders of messages outside Baton projects: a folder goes under the outermost folder seen in
// the data that holds it, unless that one is a single level deep or holds a Baton project folder.
export function folderGroups(folders: { dir: string; raw: string }[], baton: string[]): Map<string, string> {
  const roots = folders.filter(
    ({ dir }) => !dir.includes(SCRATCH) && dir.split('/').filter(Boolean).length >= 2 && !baton.some((repo) => holds(dir, repo)),
  )
  const groups = new Map<string, string>()
  for (const folder of folders) {
    if (folder.dir.includes(SCRATCH)) {
      groups.set(folder.dir, SCRATCH_GROUP)
      continue
    }
    const root = roots.filter(({ dir }) => holds(dir, folder.dir)).reduce((best, each) => (each.dir.length < best.dir.length ? each : best), folder)
    groups.set(folder.dir, root.raw.split(/[\\/]/).filter(Boolean).at(-1) ?? root.raw)
  }
  return groups
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
