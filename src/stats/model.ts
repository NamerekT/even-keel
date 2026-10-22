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
  tracked: string[]
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
  /** The task's link as the launch log recorded it (BTN-66); `null` — the page builds it from the tracker's template. */
  url: string | null
  cost: number
  limit: number | null
  sessions: number
  relays: number
  checkpoints: number
  restarts: number
  /** Context compactions of the task's main threads in the period, by the CLI itself and by `/compact`. */
  compactsAuto: number
  compactsManual: number
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
  /** The account folder key the session's messages came from. */
  account: string | null
}

export interface StatsCompaction {
  sessionId: string
  at: string
  trigger: string | null
  preTokens: number | null
  postTokens: number | null
}

export interface StatsTaskDetail {
  task: string
  sessions: StatsTaskSession[]
  spans: StatsStuck[]
  steps: StatsTaskStep[]
  compactions: StatsCompaction[]
}

// newer — the database is at a schema version this code does not know (BTN-133). The reason of off is `disabled`,
// `unchosen` (`src/stats/mode.ts`) or the `.env` variables the user's own Postgres lacks.
export type StatsAnswer<T> =
  | { state: 'ok'; data: T }
  | { state: 'off'; reason: string }
  | { state: 'error'; error: string }
  | { state: 'newer'; version: number; known: number }

export interface ReaderSettings {
  host: string
  port: number
  database: string
  user: string
  password: string
  options?: string
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

export const SCRATCH_GROUP = 'App scratch'
export const OTHER_GROUP = 'Other'

const SCRATCH = '/claude/scratch-workspaces/'
// The tail of an old sibling worktree after the folder name: Example-ex12, Example-ex-7.
const SIBLING = /^-[a-z]+-?\d+((?:\/.*)?)$/

const holds = (outer: string, inner: string) => inner.startsWith(`${outer}/`)

// What is left of dir below folder — '' for the folder itself; an old sibling worktree counts as the folder.
function restUnder(folder: string, dir: string): string | null {
  if (!dir.startsWith(folder)) return null
  const tail = dir.slice(folder.length)
  if (tail === '' || tail.startsWith('/')) return tail
  return SIBLING.exec(tail)?.[1] ?? null
}

interface Folder {
  dir: string
  raw: string
}

// Labels every folder of the messages: the key of the Even Keel project holding it (sibling worktrees too), else
// the outermost folder seen in the data or named as a move target that holds it, unless that one is a single
// level deep or holds an Even Keel project folder. A moved folder is read at its new place. Groups costing less
// than otherBelow in all go to Other.
export function folderGroups(
  folders: (Folder & { cost: number })[],
  tracked: { key: string; dir: string }[],
  moves: Record<string, string> = {},
  otherBelow = 0,
): Map<string, string> {
  const moved = Object.entries(moves)
    .map(([from, to]) => ({ from: repoTail(from), to: { dir: repoTail(to), raw: to } }))
    .sort((a, b) => b.from.length - a.from.length)
  const placeOf = (folder: Folder): Folder => {
    for (const { from, to } of moved) {
      const rest = restUnder(from, folder.dir)
      if (rest !== null) return { dir: `${to.dir}${rest}`, raw: `${to.raw}${rest}` }
    }
    return folder
  }
  const keyOf = (dir: string) =>
    tracked.filter((repo) => restUnder(repo.dir, dir) !== null).sort((a, b) => b.dir.length - a.dir.length)[0]?.key
  const places = folders.map(placeOf)
  const deep = places.filter(({ dir }) => !dir.includes(SCRATCH) && dir.split('/').filter(Boolean).length >= 2)
  const roots = [...deep, ...moved.map(({ to }) => to)].filter(({ dir }) => !tracked.some((repo) => holds(dir, repo.dir)))

  const labels = places.map((place) => {
    const key = keyOf(place.dir)
    if (key !== undefined) return { label: key, tracked: true }
    if (place.dir.includes(SCRATCH)) return { label: SCRATCH_GROUP, tracked: false }
    const root = roots
      .filter(({ dir }) => dir === place.dir || holds(dir, place.dir))
      .reduce((best, each) => (each.dir.length < best.dir.length ? each : best), place)
    return { label: root.raw.split(/[\\/]/).filter(Boolean).at(-1) ?? root.raw, tracked: false }
  })
  const costs = new Map<string, number>()
  labels.forEach(({ label }, index) => costs.set(label, (costs.get(label) ?? 0) + folders[index]!.cost))
  return new Map(
    folders.map((folder, index) => {
      const { label, tracked } = labels[index]!
      return [folder.dir, !tracked && costs.get(label)! < otherBelow ? OTHER_GROUP : label]
    }),
  )
}

/** The reader role of the user's own Postgres; a string names the variables `.env` lacks for it. */
export function readerSettings(env: Record<string, string | undefined>): ReaderSettings | string {
  const missing = ['TALLY_DB_HOST', 'TALLY_DB_NAME', 'TALLY_READER_PASSWORD'].filter((name) => !env[name])
  if (missing.length > 0) return missing.join(', ')
  return {
    host: env.TALLY_DB_HOST!,
    port: Number(env.TALLY_DB_PORT || 5432),
    database: env.TALLY_DB_NAME!,
    user: env.TALLY_READER_USER || 'tally_reader',
    password: env.TALLY_READER_PASSWORD!,
    // The planner overestimates the limit_shares join and compiles the stats queries: 2.4 s of a 3.3 s read.
    options: '-c jit=off',
  }
}
