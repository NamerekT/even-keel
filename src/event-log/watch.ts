import { isOwnName } from '../chain/fix.js'
import { isLaunch } from '../chain/launches.js'
import type { LaunchEntry } from '../chain/model.js'
import { notice, type Notice } from '../notice/notice.js'
import type { EvenKeelState } from '../state.js'
import type { EventDraft } from './model.js'
import { pageEvents, type EventsInput, type PageEvent } from './page-events.js'

export type WatchInput = EventsInput &
  Pick<EvenKeelState, 'cliVersions' | 'configError'> & {
    packages: Pick<EvenKeelState['packages'], 'gateway'>
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
}

/** An event gone and back within this is the same one: the state is read in parts, at a start above all. */
export const GRACE_MS = 10 * 60_000

/** A chain paused on the limit or a red main: its event says so (`pageEvents`), the chain's own entry would repeat it. */
const toldElsewhere = (error: Notice) => error.code === 'chain.limitSpent' || (/^(ci|check)\./.test(error.code) && 'commit' in error.params)

export function watchedOf(state: WatchInput): Watched {
  const conditions = new Map<string, EventDraft>()
  const quiet: string[] = []
  for (const event of pageEvents(state)) {
    if (event.kind === 'red') quiet.push(`${event.key}|ciRed`)
    conditions.set(event.kind === 'red' || event.kind === 'ciRed' ? `${event.key}|${event.kind}` : event.key, draftOf(event))
  }
  for (const view of state.cliVersions) conditions.set(`cli|${view.agent}|${view.account ?? ''}|${view.installed}`, { level: 'warning', notice: view.notice, place: null })
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
 * news, as a page's first state was. `changed` — whether the memory is worth saving: more than when things were seen.
 */
export function observe(memory: EventMemory | null, watched: Watched, now: Date): { drafts: EventDraft[]; memory: EventMemory; changed: boolean } {
  const stamp = now.toISOString()
  const chains = Object.fromEntries(Object.entries(watched.chains).map(([project, mark]) => [project, { paused: mark.paused, error: mark.error?.code ?? null }]))
  const seen: Record<string, string> = {}
  for (const [key, last] of Object.entries(memory?.seen ?? {})) if (now.getTime() - Date.parse(last) < GRACE_MS) seen[key] = last
  const drafts: EventDraft[] = []
  if (memory !== null) drafts.push(...chainDrafts(memory.chains, watched.chains))
  let changed = memory === null || JSON.stringify(chains) !== JSON.stringify(memory.chains)
  for (const [key, draft] of watched.conditions) {
    if (seen[key] === undefined) {
      changed = true
      if (memory !== null) drafts.push(draft)
    }
    seen[key] = stamp
  }
  for (const key of watched.quiet) {
    if (seen[key] === undefined) changed = true
    seen[key] = stamp
  }
  return { drafts, memory: { seen, chains }, changed }
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

/** The entry of a session launched, from the launch log; its releases and outcomes are no launch. */
export function launchDraft(entry: LaunchEntry): EventDraft | null {
  if (!isLaunch(entry)) return null
  const place = isOwnName(entry.task) ? { view: 'project' as const, project: entry.project } : { view: 'task' as const, project: entry.project, task: entry.task }
  return { level: 'info', notice: notice('eventLog.launch', { task: entry.task }), place }
}

/** The entry of a session the chain stopped mid-turn: a red main or subscription overage (invariant 1). */
export function stopDraft(project: string, task: string): EventDraft {
  return { level: 'info', notice: notice('eventLog.stopped', { task }), place: { view: 'project', project } }
}
