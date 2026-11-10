/**
 * The README badge's state (BTN-915): what the service pushes to the Worker and what `renderBadge` draws. Version 1 of
 * the contract with the Worker; a field the project's settings leave out is absent, never `null` (`docs/badge.md`).
 */
export const BADGE_VERSION = 1

/** The fields a project picks for its badge; the rest never leave the service. */
export const BADGE_FIELDS = ['title', 'agent', 'model', 'time', 'action', 'context', 'chain', 'milestone', 'sessions', 'medianCost', 'medianMinutes'] as const
export type BadgeField = (typeof BADGE_FIELDS)[number]

export const isBadgeField = (value: unknown): value is BadgeField => typeof value === 'string' && (BADGE_FIELDS as readonly string[]).includes(value)

/** A tool call as the badge shows it: the tool for the icon, its name and short description for the text. */
export interface BadgeAction {
  tool: string
  text: string
}

export interface BadgeTask {
  key: string
  /** The title in English (BTN-918); the tracker's own title never leaves the service. */
  titleEn?: string
  agent?: string
  model?: string
  startedAt?: string
  /** `waiting` — for the maintainer's answer; `limit` — for the usage limit to reset (BTN-969). */
  state: BadgeTaskState
  /** When the limit a `limit` task waits for resets; absent — not known. Never the account it is of. */
  until?: string
  action?: BadgeAction | null
  /** How full the context is, whole percents. */
  context?: number
}

export type BadgeChainState = 'running' | 'paused' | 'stopped' | 'idle'
export type BadgeTaskState = 'working' | 'waiting' | 'limit'
export type BadgeChipState = 'done' | BadgeTaskState | 'queued'

export interface BadgeChain {
  state: BadgeChainState
  /** The task the chain takes next; `null` — none. */
  next: string | null
  tasks?: BadgeChip[]
}

export interface BadgeChip {
  key: string
  state: BadgeChipState
  /** When the chain closed a `done` task, as the service's clock showed it (`localStamp`); absent — not known. */
  doneAt?: string
}

/**
 * `left` is every open task of the milestone, `queued` those of them the chain takes; the rest wait for the maintainer.
 * A state without `queued` is of a service before BTN-970.
 */
export interface BadgeMilestone {
  name: string
  done: number
  left: number
  queued?: number
  /** The day the chain gets through `queued` at its pace of the last 7 days, `YYYY-MM-DD`; absent — no pace to count by. */
  eta?: string
  /** The milestone's own date in the tracker, `YYYY-MM-DD`; absent — the tracker has none. */
  target?: string
}

export interface BadgeStats {
  sessions?: number
  /** At API list prices, dollars. */
  medianCost?: number
  medianMinutes?: number
}

export interface BadgeState {
  v: typeof BADGE_VERSION
  at: string
  project: { key: string; name: string }
  active: BadgeTask[]
  chain: BadgeChain
  milestone?: BadgeMilestone | null
  stats?: BadgeStats
}

/** A project's `badge` setting: whether it publishes, where to, and what. */
export interface BadgeSettings {
  on: boolean
  /** The Worker's address, without the path. */
  url: string
  /** The project's name on the Worker: `<url>/<slug>.svg`. */
  slug: string
  fields: BadgeField[]
}

export const BADGE_SECRET = 'EVEN_KEEL_BADGE_SECRET'
