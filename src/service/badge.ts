import { ALL_BADGE_FIELDS, badgeStateOf } from '../badge/collect.js'
import { BADGE_SECRET, type BadgeField, type BadgeStats } from '../badge/model.js'
import { BadgePusher, postBadge, type BadgePushDeps } from '../badge/push.js'
import { renderBadge } from '../badge/render.js'
import { badgePushes } from '../badge/settings.js'
import { badgeStatsOf, badgeStatsRange } from '../badge/stats.js'
import type { EvenKeelConfig } from '../config.js'
import type { EvenKeelState } from '../state.js'
import type { PeriodQuery, StatsAnswer, StatsPeriod } from '../stats/model.js'

/** The project's numbers are read from the stats no more often than this. */
export const BADGE_STATS_MS = 15 * 60_000

export interface BadgeWiringDeps {
  config: () => EvenKeelConfig
  state: () => EvenKeelState
  /** The stats reader's period; its answer `off` or a failure leaves the badge without numbers. */
  period: (query: PeriodQuery) => Promise<StatsAnswer<StatsPeriod>>
  now?: () => number
  tz?: string
  post?: BadgePushDeps['post']
  secret?: () => string | undefined
  log?: (line: string) => void
}

export interface BadgeWiring {
  /** Looks at every project's badge: on each state change and on a timer. */
  tick: () => Promise<void>
  /** The project's badge as the page previews it; `undefined` — no such project. */
  svg: (project: string, theme: 'dark' | 'light') => string | undefined
}

/**
 * The README badge inside the service (BTN-915): the pusher over the live config, so turning a badge on, off or
 * elsewhere applies at the next tick, and the page's preview. The numbers come from the stats at most every 15 min.
 */
export function wireBadges(deps: BadgeWiringDeps): BadgeWiring {
  const now = deps.now ?? Date.now
  const tz = deps.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const numbers = new Map<string, { at: number; stats: BadgeStats | null }>()
  const reading = new Set<string>()

  const statsOf = (project: string): BadgeStats | null => {
    const known = numbers.get(project)
    if ((known === undefined || now() - known.at >= BADGE_STATS_MS) && !reading.has(project)) {
      reading.add(project)
      const query: PeriodQuery = { scope: 'all', account: null, tz, includeTests: true, ...badgeStatsRange(new Date(now()), tz), projects: [project] }
      void deps
        .period(query)
        .then((answer) => (answer.state === 'ok' ? badgeStatsOf(answer.data) : null))
        .catch(() => null)
        .then((stats) => numbers.set(project, { at: now(), stats }))
        .finally(() => reading.delete(project))
    }
    return known?.stats ?? null
  }

  const stateOf = (project: string, fields: readonly BadgeField[]) => {
    const state = deps.state()
    if (!state.projects.includes(project)) return undefined
    return badgeStateOf(state, project, { now: new Date(now()), fields, stats: statsOf(project) })
  }

  const pusher = new BadgePusher({
    targets: () =>
      Object.entries(deps.config().settings).flatMap(([project, { badge }]) =>
        badgePushes(badge) ? [{ project, settings: badge, state: () => stateOf(project, badge.fields) }] : [],
      ),
    secret: deps.secret ?? (() => process.env[BADGE_SECRET]),
    post: deps.post ?? postBadge,
    now,
    log: deps.log ?? ((line) => console.log(line)),
  })

  return {
    tick: () => pusher.tick(),
    svg: (project, theme) => {
      const fields = deps.config().settings[project]?.badge?.fields ?? ALL_BADGE_FIELDS
      const state = stateOf(project, fields)
      return state === undefined ? undefined : renderBadge(state, { theme, now: new Date(now()) })
    },
  }
}
