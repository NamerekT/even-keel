export const STATS_DAYS = [7, 30] as const
export type StatsDays = (typeof STATS_DAYS)[number]
export type StatsScope = 'all' | 'chain'

export interface StatsQuery {
  days: StatsDays
  scope: StatsScope
}

export interface StatsTotal {
  cost: number
  previousCost: number
  messages: number
  sessions: number
  unpriced: number
  fiveHour: number | null
  sevenDay: number | null
}

export interface StatsTask {
  task: string
  title: string | null
  status: string | null
  cost: number
  sessions: number
  sevenDay: number | null
}

export interface StatsRepeat {
  task: string
  title: string | null
  status: string | null
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
  sessionId: string
  fromAt: string
  toAt: string
  kinds: string[]
  reason: string | null
  note: string | null
}

export interface ProjectStats {
  project: string
  query: StatsQuery
  since: string
  at: string
  total: StatsTotal
  service: { cost: number; sessions: number }
  tasks: StatsTask[]
  repeats: StatsRepeat[]
  stuck: StatsStuck[]
  reasons: { reason: string | null; spans: number }[]
}

export type StatsAnswer =
  | { state: 'ok'; stats: ProjectStats }
  | { state: 'off'; reason: string }
  | { state: 'error'; error: string }

export interface ReaderSettings {
  host: string
  port: number
  database: string
  user: string
  password: string
}

export function parseStatsQuery(params: URLSearchParams): StatsQuery {
  const days = Number(params.get('days') ?? 7)
  if (!STATS_DAYS.includes(days as StatsDays)) throw new Error(`days must be one of ${STATS_DAYS.join(', ')}`)
  const scope = params.get('scope') ?? 'all'
  if (scope !== 'all' && scope !== 'chain') throw new Error('scope must be all or chain')
  return { days: days as StatsDays, scope }
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
