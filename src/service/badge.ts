import { checkBadge, getBadge, type BadgeCheck, type BadgeCheckDeps } from '../badge/check.js'
import { ALL_BADGE_FIELDS, badgeStateOf } from '../badge/collect.js'
import { englishOf, fail } from '../notice/notice.js'
import { BADGE_SECRET, type BadgeField, type BadgeStats } from '../badge/model.js'
import { BadgePusher, postBadge, type BadgePushDeps } from '../badge/push.js'
import { renderBadge } from '../badge/render.js'
import { badgePushes } from '../badge/settings.js'
import { badgeStatsOf, badgeStatsRange } from '../badge/stats.js'
import { BadgeTranslations } from '../badge/translate.js'
import { privateLayer, withoutPrivate, type PrivacyField, type PrivacyLayer } from '../badge/privacy.js'
import { StatusAsks, statusRequest } from '../badge/status.js'
import { runGit } from '../git/run.js'
import { bannedFor, machineFacts, type GitIdentity, type MachineFacts } from './badge-private.js'
import { readerOf, readersOf, readKeyOf, type EvenKeelConfig } from '../config.js'
import { keptDatabase } from '../storage/owner.js'
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
  get?: BadgeCheckDeps['get']
  secret?: () => string | undefined
  log?: (line: string) => void
  translations?: BadgeTranslations
  machine?: MachineFacts
  /** The name and e-mail the repository commits as (`git config`). */
  identity?: (repo: string) => Promise<GitIdentity>
}

const LEFT_OUT: Record<PrivacyField, string> = { titleEn: 'the English title', 'action.text': 'the action text', 'action.tool': 'the action', 'action.status': 'the status line' }
const LAYERS: Record<Exclude<PrivacyLayer, 'unready'>, string> = {
  identifier: 'it names this machine, an account, a profile or another project (layer 1)',
  pattern: 'it looks like a secret, a contact, an address or a path (layer 2)',
  error: 'the filter failed',
}

async function readIdentity(repo: string): Promise<GitIdentity> {
  const [name, email] = await Promise.all(['user.name', 'user.email'].map(async (key) => {
    const read = await runGit(repo, ['config', '--get', key])
    return read.code === 0 && read.out.trim() !== '' ? read.out.trim() : null
  }))
  return { name: name ?? null, email: email ?? null }
}

export interface BadgeWiring {
  /**
   * The request for a `status: …` line to put into the context of a chain's session at its tool call (BTN-932), or
   * `null`: the project's badge is off or shows no action, its last push did not go through, the chain does not run
   * this session, its agent writes no status, or the last status or request is younger than two minutes.
   */
  statusAsk: (sessionId: string) => string | null
  /** Looks at every project's badge: on each state change and on a timer. */
  tick: () => Promise<void>
  /** The project's badge as the page previews it; `undefined` — no such project. */
  svg: (project: string, theme: 'dark' | 'light') => string | undefined
  /** The badge dialog's "Check": the project's state pushed to the address and name, its picture read back. */
  check: (project: string, url: string, slug: string) => Promise<BadgeCheck>
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
  let translations = deps.translations

  const titleOf = (state: EvenKeelState, project: string, id: string): string | undefined => {
    const task = state.tasks.find((each) => each.project === project && each.id === id)
    if (task === undefined || task.title.trim() === '') return undefined
    const config = deps.config()
    const reader = readerOf(config, project, id)
    const readers = readersOf(config)
    const kind = readers.trackers[reader]!
    const profiles = state.profiles?.profiles ?? []
    const profile = profiles.find((each) => each.kind === kind && each.projectIds.includes(reader)) ?? profiles.find((each) => each.kind === kind && each.isDefault)
    const tracker = JSON.stringify([kind, profile?.id ?? '', kind === 'builtin' ? reader : readKeyOf(readers, reader)])
    translations ??= new BadgeTranslations(keptDatabase().db, { now, log: deps.log })
    return translations.title({ tracker, id, title: task.title }, config.settings[project]?.badge?.on === true)
  }

  const statsOf = (project: string): BadgeStats | null => {
    const key = deps.config().keys[project]
    if (key === undefined) return null
    const known = numbers.get(key)
    if ((known === undefined || now() - known.at >= BADGE_STATS_MS) && !reading.has(key)) {
      reading.add(key)
      const query: PeriodQuery = { scope: 'all', account: null, tz, includeTests: true, ...badgeStatsRange(new Date(now()), tz), projects: [key] }
      void deps
        .period(query)
        .then((answer) => (answer.state === 'ok' ? badgeStatsOf(answer.data) : null))
        .catch(() => null)
        .then((stats) => numbers.set(key, { at: now(), stats }))
        .finally(() => reading.delete(key))
    }
    return known?.stats ?? null
  }

  const log = deps.log ?? ((line: string) => console.log(line))
  const machine = deps.machine ?? machineFacts()
  const identities = new Map<string, { at: number; identity: GitIdentity | undefined }>()
  const identifying = new Set<string>()

  /** The repository's git identity, read in the background at most every 15 min; `undefined` — never read yet. */
  const identityOf = (repo: string | undefined): GitIdentity | undefined => {
    if (repo === undefined) return { name: null, email: null }
    const known = identities.get(repo)
    if ((known === undefined || now() - known.at >= BADGE_STATS_MS) && !identifying.has(repo)) {
      identifying.add(repo)
      void (deps.identity ?? readIdentity)(repo)
        .then((identity) => identities.set(repo, { at: now(), identity }))
        .catch(() => identities.set(repo, { at: now(), identity: known?.identity }))
        .finally(() => identifying.delete(repo))
    }
    return known?.identity
  }

  const reported = new Set<string>()
  /** One line per project, field and layer, never the text itself. */
  const report = (key: string, field: PrivacyField, layer: PrivacyLayer) => {
    if (layer === 'unready') return
    const line = `badge: ${key}: ${LEFT_OUT[field]} is left out, ${LAYERS[layer]}`
    if (reported.has(line)) return
    reported.add(line)
    log(line)
  }

  /** The one state of a project: the push, the preview and the check all take it filtered (BTN-931). */
  const stateOf = (project: string, fields: readonly BadgeField[]) => {
    const state = deps.state()
    if (!state.projects.includes(project)) return undefined
    const key = state.projectKeys[project] ?? project
    const config = deps.config()
    const identity = identityOf(config.projects[project])
    let banned: string[] | null = null
    try {
      if (identity !== undefined) banned = bannedFor(state, config, project, machine, identity)
    } catch {
      report(key, 'action.text', 'error')
    }
    const statusOk = (text: string) => {
      const layer = privateLayer(text, banned)
      if (layer !== null) report(key, 'action.status', layer)
      return layer === null
    }
    const built = badgeStateOf(state, project, { now: new Date(now()), fields, stats: statsOf(project), titleEn: (id) => titleOf(state, project, id), statusOk })
    return withoutPrivate(built, banned, (field, layer) => report(key, field, layer))
  }

  const secret = deps.secret ?? (() => process.env[BADGE_SECRET])
  const post = deps.post ?? postBadge
  const fieldsOf = (project: string) => deps.config().settings[project]?.badge?.fields ?? ALL_BADGE_FIELDS
  const pusher = new BadgePusher({
    targets: () =>
      Object.entries(deps.config().settings).flatMap(([project, { badge }]) =>
        badgePushes(badge) ? [{ project, settings: badge, state: () => stateOf(project, badge.fields) }] : [],
      ),
    secret,
    post,
    now,
    log,
  })

  const asks = new StatusAsks()

  return {
    statusAsk: (sessionId) => {
      const state = deps.state()
      asks.keep(new Set(state.sessions.map((session) => session.sessionId)))
      const chain = state.chain.active.find((each) => each.current?.sessionId === sessionId)
      const session = state.sessions.find((each) => each.sessionId === sessionId)
      if (chain === undefined || session === undefined || session.badgeStatus === undefined) return null
      const badge = deps.config().settings[chain.project]?.badge
      if (!badgePushes(badge) || !badge.fields.includes('action') || !pusher.pushed(chain.project)) return null
      return asks.due(sessionId, session.badgeStatus, now()) ? statusRequest() : null
    },
    tick: () => pusher.tick(),
    svg: (project, theme) => {
      const state = stateOf(project, fieldsOf(project))
      return state === undefined ? undefined : renderBadge(state, { theme, now: new Date(now()) })
    },
    check: async (project, url, slug) => {
      const state = stateOf(project, fieldsOf(project))
      if (state === undefined) throw fail('chain.unknownProject', { project })
      const { cause, ...result } = await checkBadge({ url, slug }, { secret: secret(), state, now, post, get: deps.get ?? getBadge })
      log(`badge: the check of ${url.trim()} for ${state.project.key}: ${englishOf(result.notice)}${cause === undefined ? '' : ` (${cause})`}`)
      return result
    },
  }
}
