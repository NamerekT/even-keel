import { isCarryName, isFixName } from '../chain/fix.js'
import { isLaunch } from '../chain/launches.js'
import type { LaunchEntry } from '../chain/model.js'
import type { LoggedPackageProblem } from '../notice/en.js'
import { notice, type Notice } from '../notice/notice.js'
import type { EvenKeelState, PackageProblem, ProjectPackages } from '../state.js'
import type { EventDraft, EventLevel } from './model.js'
import { pageEvents, type EventsInput, type PageEvent } from './page-events.js'

export type WatchInput = EventsInput &
  Pick<EvenKeelState, 'cliVersions' | 'configError'> & {
    packages: Pick<EvenKeelState['packages'], 'gateway' | 'projects'>
    account: Pick<EvenKeelState['account'], 'accounts' | 'pool'>
  }

/** A chain as the log tells its changes: its pause, and the error it is held on unless another entry says it. */
interface ChainMark {
  paused: boolean
  error: Notice | null
}

/** What holds now: the events by their keys, and the chains. */
export interface Watched {
  conditions: Map<string, EventDraft>
  /** Keys seen with the conditions without an entry of their own: a CI red again but no longer held after a red main. */
  quiet: string[]
  chains: Record<string, ChainMark>
}

/**
 * What the log remembers between looks, kept over a restart: when each event was last seen and each chain's mark,
 * its error by the code.
 */
export interface EventMemory {
  seen: Record<string, string>
  chains: Record<string, { paused: boolean; error: string | null }>
  /** A key of `seen` not held now, by the first look without it: it is kept until `BLINK_MS` past that. */
  gone?: Record<string, string>
}

/** The conditions remembered over a restart, held as seen until `until` (ms) though not seen: `GRACE_MS` after the start. */
export interface Restored {
  keys: ReadonlySet<string>
  until: number
}

/** How long after a start the conditions remembered before it count as held: the state is read in parts then. */
export const GRACE_MS = 10 * 60_000

/**
 * A condition gone and back within this is the same one: the state is built from parts read each on its own, and a
 * failed or partial read may drop a condition from one or two builds (one each `EventHub.watch` window, 2 s). Longer —
 * a new entry: a conflict back after five minutes is news.
 */
export const BLINK_MS = 5_000

/** Problems that pass by themselves, and one that is the agent's, not a problem to fix: no entry. */
const UNLOGGED = new Set<PackageProblem['kind']>(['installing', 'probing', 'unsupported'])

/** A chain paused on the limit or a red main: its event says so (`pageEvents`), the chain's own entry would repeat it. */
const toldElsewhere = (error: Notice) => error.code === 'chain.limitSpent' || (/^(ci|check)\./.test(error.code) && 'commit' in error.params)

export function watchedOf(state: WatchInput): Watched {
  const conditions = new Map<string, EventDraft>()
  const quiet: string[] = []
  for (const event of pageEvents(state)) {
    if (event.kind === 'red') quiet.push(`${event.key}|ciRed`)
    conditions.set(event.kind === 'red' || event.kind === 'ciRed' ? `${event.key}|${event.kind}` : event.key, draftOf(event))
  }
  // The installed CLI's way back to the checked version is its source in the settings; a daemon has none to press.
  for (const view of state.cliVersions) {
    const place = view.account === null ? { view: 'settings' as const, project: null } : null
    conditions.set(`cli|${view.agent}|${view.account ?? ''}|${view.installed}`, { level: 'warning', notice: view.notice, place })
  }
  for (const [project, found] of Object.entries(state.packages.projects)) {
    for (const [key, draft] of packageDrafts(project, found)) conditions.set(key, draft)
  }
  const pooled = new Set(state.account.pool.map((entry) => entry.account))
  for (const entry of state.account.accounts) {
    const { state: health, since, reason } = entry.usage
    if (!pooled.has(entry.key) || entry.needsLogin || (health !== 'unread' && health !== 'off')) continue
    const code = health === 'off' ? 'eventLog.usageOff' : 'eventLog.usageUnread'
    conditions.set(`usage|${entry.key}|${health}:${since}`, {
      level: health === 'off' ? 'error' : 'warning',
      notice: notice(code, { account: entry.key }, reason === null ? {} : { cause: reason }),
      place: { view: 'accounts' },
    })
  }
  const gateway = state.packages.gateway
  if (gateway !== null) conditions.set(`gateway|${JSON.stringify(gateway)}`, { level: 'error', notice: gateway, place: null })
  if (state.configError !== null) conditions.set(`config|${JSON.stringify(state.configError)}`, { level: 'error', notice: state.configError, place: { view: 'settings', project: null } })
  const chains: Record<string, ChainMark> = {}
  for (const chain of state.chain.active) {
    if (chain.fixOnly === true) continue
    // A pause another entry tells is no pause of the chain's own, nor is its end a resume.
    if (chain.paused && chain.error !== null && toldElsewhere(chain.error)) chains[chain.project] = { paused: false, error: null }
    else chains[chain.project] = { paused: chain.paused, error: chain.paused ? chain.error : null }
  }
  return { conditions, quiet, chains }
}

/** A project's package problems by their keys: of the set as a whole and of its enabled packages, as /tools counts them. */
function packageDrafts(project: string, found: ProjectPackages): [string, EventDraft][] {
  const level: EventLevel = found.blocked ? 'error' : 'warning'
  const named: [string | null, PackageProblem][] = [
    ...found.problems.map((problem): [null, PackageProblem] => [null, problem]),
    ...Object.entries(found.cells).flatMap(([name, cell]) => (cell.enabled ? cell.problems.map((problem): [string, PackageProblem] => [name, problem]) : [])),
  ]
  return named.flatMap(([name, problem]) => {
    if (UNLOGGED.has(problem.kind)) return []
    const detail = problem.kind === 'noKey' ? problem.variables.join(', ') : problem.kind === 'noResponse' ? problem.servers.join(', ') : problem.kind === 'noTrackerMcp' ? problem.server : ''
    const params = { project, ...(name !== null && { package: name }), problem: problem.kind as LoggedPackageProblem, detail }
    const cause = problem.kind === 'installFailed' ? { cause: problem.notice } : {}
    return [[`packages|${project}|${name ?? ''}|${JSON.stringify(problem)}`, { level, notice: notice('eventLog.packages', params, cause), place: { view: 'packages', project } }]]
  })
}

function draftOf(event: PageEvent): EventDraft {
  if (event.kind === 'limit') return { level: 'warning', notice: notice('eventLog.limit', { project: event.project }), place: { view: 'project', project: event.project } }
  if (event.kind === 'red' || event.kind === 'ciRed') {
    const params = { project: event.project, commit: event.commit, cis: event.cis }
    return event.kind === 'red'
      ? { level: 'error', notice: notice('eventLog.red', params), place: { view: 'ci', project: event.project } }
      : { level: 'warning', notice: notice('eventLog.ciRed', params), place: { view: 'ci', project: event.project } }
  }
  if (event.kind === 'ask') return { level: 'warning', notice: notice('eventLog.ask', { task: event.task }), place: { view: 'ask', project: event.project, task: event.task } }
  if (event.kind === 'conflict') {
    return { level: 'error', notice: notice('eventLog.conflict', { project: event.project, into: event.into }), place: { view: 'project', project: event.project } }
  }
  const params = { task: event.task, path: event.path }
  return {
    level: 'warning',
    notice: event.files > 0 ? notice('eventLog.uncommitted', params) : notice('eventLog.unmerged', params),
    place: event.backlog ? { view: 'backlog', project: event.project } : { view: 'task', project: event.project, task: event.task },
  }
}

/**
 * The entries of the step from what the log remembers to what holds now. With nothing remembered yet everything is old
 * news, as a page's first state was. A condition not held now is kept a `BLINK_MS` from the first look without it, one
 * of `restored` until its end. `changed` — whether the memory is worth saving: more than when things were seen.
 */
export function observe(
  memory: EventMemory | null,
  watched: Watched,
  now: Date,
  restored?: Restored,
): { drafts: EventDraft[]; memory: EventMemory; changed: boolean } {
  const stamp = now.toISOString()
  const time = now.getTime()
  const chains = Object.fromEntries(Object.entries(watched.chains).map(([project, mark]) => [project, { paused: mark.paused, error: mark.error?.code ?? null }]))
  const held = new Set([...watched.conditions.keys(), ...watched.quiet])
  const seen: Record<string, string> = {}
  const gone: Record<string, string> = {}
  let changed = memory === null || JSON.stringify(chains) !== JSON.stringify(memory.chains)
  const kept = (key: string, since: string) => (restored?.keys.has(key) === true && time < restored.until) || time - Date.parse(since) < BLINK_MS
  for (const [key, last] of Object.entries(memory?.seen ?? {})) {
    if (held.has(key)) continue
    const since = memory?.gone?.[key] ?? stamp
    if (kept(key, since)) {
      seen[key] = last
      gone[key] = since
    } else changed = true
  }
  const known = (key: string) => {
    const since = memory?.gone?.[key]
    return memory?.seen[key] !== undefined && (since === undefined || kept(key, since))
  }
  const drafts: EventDraft[] = []
  if (memory !== null) drafts.push(...chainDrafts(memory.chains, watched.chains))
  for (const [key, draft] of watched.conditions) {
    if (!known(key)) {
      changed = true
      if (memory !== null) drafts.push(draft)
    }
    seen[key] = stamp
  }
  for (const key of watched.quiet) {
    if (!known(key)) changed = true
    seen[key] = stamp
  }
  return { drafts, memory: { seen, chains, gone }, changed }
}

function chainDrafts(before: EventMemory['chains'], after: Record<string, ChainMark>): EventDraft[] {
  const drafts: EventDraft[] = []
  const entry = (code: 'eventLog.chainStarted' | 'eventLog.chainStopped' | 'eventLog.chainPaused' | 'eventLog.chainResumed', project: string): EventDraft => ({
    level: 'info',
    notice: notice(code, { project }),
    place: { view: 'project', project },
  })
  for (const [project, mark] of Object.entries(after)) {
    const was = before[project]
    if (was === undefined) drafts.push(entry('eventLog.chainStarted', project))
    if (mark.error !== null) {
      if (mark.error.code !== was?.error) drafts.push({ level: 'error', notice: notice('eventLog.chainHeld', { project }, { cause: mark.error }), place: { view: 'project', project } })
    } else if (was !== undefined && mark.paused !== was.paused) drafts.push(entry(mark.paused ? 'eventLog.chainPaused' : 'eventLog.chainResumed', project))
  }
  for (const project of Object.keys(before)) if (after[project] === undefined) drafts.push(entry('eventLog.chainStopped', project))
  return drafts
}

type RawSettings = Record<string, unknown>

/** The entries of a change of the settings, in the shape of the config file (`ConfigStore.raw`). */
export function settingsDrafts(before: RawSettings, after: RawSettings): EventDraft[] {
  const drafts: EventDraft[] = []
  const shared = (raw: RawSettings) => JSON.stringify({ ...raw, projects: undefined })
  if (shared(before) !== shared(after)) drafts.push({ level: 'info', notice: notice('eventLog.settings', {}), place: { view: 'settings', project: null } })
  const was = projectsOf(before)
  const now = projectsOf(after)
  for (const [id, entry] of now) {
    const old = was.get(id)
    if (old === undefined) drafts.push({ level: 'info', notice: notice('eventLog.projectAdded', { project: id }), place: { view: 'project', project: id } })
    else if (JSON.stringify(old) !== JSON.stringify(entry)) {
      drafts.push({ level: 'info', notice: notice('eventLog.projectSettings', { project: id }), place: { view: 'settings', project: id } })
    }
  }
  for (const [id, entry] of was) {
    if (!now.has(id)) drafts.push({ level: 'info', notice: notice('eventLog.projectRemoved', { key: String(entry.key ?? id) }), place: null })
  }
  return drafts
}

function projectsOf(raw: RawSettings): Map<string, Record<string, unknown>> {
  const list = Array.isArray(raw.projects) ? (raw.projects as Record<string, unknown>[]) : []
  return new Map(list.filter((entry) => typeof entry.id === 'string').map((entry) => [entry.id as string, entry]))
}

/**
 * The entry of a session launched, from the launch log; its releases and outcomes are no launch. A fix of main or a
 * carry has no task: its entry names the project (BTN-781). A task's entry with a `previous` session is the same
 * session going on, or a new one in its place by a handoff (BTN-853).
 */
export function launchDraft(entry: LaunchEntry): EventDraft | null {
  if (!isLaunch(entry)) return null
  const { project, task, sessionId, previous, reason, cause } = entry
  if (isFixName(task)) return { level: 'info', notice: notice('eventLog.fixLaunch', { project }), place: { view: 'project', project } }
  if (isCarryName(task)) return { level: 'info', notice: notice('eventLog.carryLaunch', { project }), place: { view: 'project', project } }
  const place = { view: 'task', project, task } as const
  if (previous === sessionId) {
    const why = reason === 'answer' || reason === 'resume' || reason === 'review' ? reason : undefined
    return { level: 'info', notice: notice('eventLog.continued', { task, ...(why === undefined ? {} : { why }) }), place }
  }
  if (previous !== undefined) {
    const why = cause ?? (reason === 'restart' || reason === 'checkpoint' ? reason : undefined)
    return { level: 'info', notice: notice('eventLog.handoff', { task, ...(why === undefined ? {} : { why }) }), place }
  }
  return { level: 'info', notice: notice('eventLog.launch', { task }), place }
}

/** The entry of a session the chain stopped mid-turn: a red main or subscription overage (invariant 1). */
export function stopDraft(project: string, task: string): EventDraft {
  const said = isFixName(task) ? notice('eventLog.fixStopped', { project }) : isCarryName(task) ? notice('eventLog.carryStopped', { project }) : notice('eventLog.stopped', { task })
  return { level: 'info', notice: said, place: { view: 'project', project } }
}
