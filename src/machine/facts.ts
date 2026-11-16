import { accountAt, type AccountLedger } from '../account/ledger.js'
import { accountId } from '../account/model.js'
import type { LimitsWait, ModelWeekHold } from '../chain/model.js'
import type { AccountNow, HandoffSession, LimitedSession } from '../chain/relay.js'
import { limitReopenedAt, type RateLimits } from '../limits/model.js'
import type { OverageSession } from '../limits/overage-session.js'
import type { Notice } from '../notice/notice.js'
import type { MachinePort } from './port.js'

/** What the machine knows of a task's sessions; a field left out is the port's neutral answer. */
export interface TaskFacts {
  live?: string
  busy?: true
  midTurn?: true
  shell?: true
  asked?: string
  silentSince?: string
  limited?: LimitedSession
  overage?: OverageSession
  handoff?: HandoffSession
  /** By session id: the model refusal of its completed turn. */
  refusals?: Record<string, Notice>
}

/** What a new session would start on: the project's default, or a task's own run. */
export interface RunFacts {
  account: AccountNow
  model: string | null
  launchBlock?: Notice
  limitReset: string | null
  modelWeek: ModelWeekHold | null
  limitsUnread?: LimitsWait
}

export interface ProjectFacts {
  packagesBlocked?: true
  packagesPause?: Notice
  trackerMissing?: string
  run: RunFacts
  /** Only the tasks that have a run of their own. */
  tasks: Record<string, RunFacts>
  /** `reportedTree` by task. */
  reported: Record<string, string>
}

/**
 * The machine's state as its hub mirrors it (`docs/machines.md`, "The mirror"): the values of the port's snapshot
 * members, computed by the machine for every key the chain may ask about. The reads with a free time — `accountAt`,
 * `limitReopenedAt` — are computed by the hub from `ledger` and `limits`.
 */
export interface MachineFacts {
  sessionsRead: boolean
  accountsRead: boolean
  tasks: Record<string, TaskFacts>
  projects: Record<string, ProjectFacts>
  ledger: AccountLedger['accounts']
  /** By account folder. */
  limits: Record<string, RateLimits | null>
  /** `limitResetAfter` of the sessions a limit stopped, by `resetKey`. */
  resets: Record<string, string | null>
}

export const resetKey = (account: string, at: string, text?: string): string => `${account}\n${at}\n${text ?? ''}`

const SECTIONS = ['tasks', 'projects', 'ledger', 'limits', 'resets'] as const
type Section = (typeof SECTIONS)[number]

/** The entries of one section that changed since the last post: `set` — new or changed, `gone` — no longer there. */
export interface SectionPatch<V> {
  set?: Record<string, V>
  gone?: string[]
}

export type FactsPatch = Partial<Pick<MachineFacts, 'sessionsRead' | 'accountsRead'>> & { [K in Section]?: SectionPatch<MachineFacts[K][string]> }

/** `undefined` — nothing changed. */
export function patchOf(before: MachineFacts, after: MachineFacts): FactsPatch | undefined {
  const patch: FactsPatch = {}
  if (before.sessionsRead !== after.sessionsRead) patch.sessionsRead = after.sessionsRead
  if (before.accountsRead !== after.accountsRead) patch.accountsRead = after.accountsRead
  for (const section of SECTIONS) {
    const was = before[section] as Record<string, unknown>
    const now = after[section] as Record<string, unknown>
    const set: Record<string, unknown> = {}
    for (const key of Object.keys(now)) if (!Object.hasOwn(was, key) || JSON.stringify(was[key]) !== JSON.stringify(now[key])) set[key] = now[key]
    const gone = Object.keys(was).filter((key) => !Object.hasOwn(now, key))
    if (Object.keys(set).length === 0 && gone.length === 0) continue
    ;(patch as Record<string, unknown>)[section] = { ...(Object.keys(set).length > 0 && { set }), ...(gone.length > 0 && { gone }) }
  }
  return Object.keys(patch).length === 0 ? undefined : patch
}

export function applyPatch(facts: MachineFacts, patch: FactsPatch): MachineFacts {
  const next: MachineFacts = { ...facts }
  if (patch.sessionsRead !== undefined) next.sessionsRead = patch.sessionsRead
  if (patch.accountsRead !== undefined) next.accountsRead = patch.accountsRead
  for (const section of SECTIONS) {
    const changed = patch[section] as SectionPatch<unknown> | undefined
    if (changed === undefined) continue
    const entries: Record<string, unknown> = { ...facts[section], ...changed.set }
    for (const key of changed.gone ?? []) delete entries[key]
    ;(next as unknown as Record<string, unknown>)[section] = entries
  }
  return next
}

export type MirrorReads = Pick<MachinePort,
  | 'liveSession' | 'lastSession' | 'busy' | 'midTurn' | 'shell' | 'asked' | 'silentSince' | 'limited' | 'overage' | 'handoff' | 'modelRefusal'
  | 'sessionsRead' | 'reportedTree' | 'account' | 'accountAt' | 'launchBlock' | 'limitReset' | 'modelWeek' | 'limitResetAfter' | 'limitReopenedAt'
  | 'limitsUnread' | 'accountsRead' | 'packagesBlocked' | 'packagesPause' | 'trackerMissing'
>

/**
 * The port's snapshot members over the mirror. Without facts — before the machine's first snapshot — nothing is read
 * (`sessionsRead` and `accountsRead` are `false`), so the chain does not step.
 */
export function mirrorReads(facts: () => MachineFacts | undefined, lastSession: (project: string, task: string) => string | undefined): MirrorReads {
  const task = (name: string): TaskFacts => facts()?.tasks[name] ?? {}
  const run = (project: string, name?: string): RunFacts | undefined => {
    const known = facts()?.projects[project]
    return (name === undefined ? undefined : known?.tasks[name]) ?? known?.run
  }
  return {
    liveSession: (name) => task(name).live,
    lastSession,
    busy: (name) => task(name).busy === true,
    midTurn: (name) => task(name).midTurn === true,
    shell: (name) => task(name).shell === true,
    asked: (name) => task(name).asked ?? null,
    silentSince: (name) => task(name).silentSince ?? null,
    limited: (name) => task(name).limited,
    overage: (name) => task(name).overage,
    handoff: (name) => task(name).handoff,
    modelRefusal: (name, sessionId) => task(name).refusals?.[sessionId],
    sessionsRead: () => facts()?.sessionsRead === true,
    reportedTree: (project, name) => facts()?.projects[project]?.reported[name] ?? null,
    account: (project, name) => run(project, name)?.account ?? { id: null, ready: false },
    accountAt: (key, at) => accountId(key, accountAt({ accounts: facts()?.ledger ?? {}, removing: [] }, key, at)),
    launchBlock: (project, name) => run(project, name)?.launchBlock,
    limitReset: (project, name) => run(project, name)?.limitReset ?? null,
    modelWeek: (project, name) => run(project, name)?.modelWeek ?? null,
    limitResetAfter: (account, at, text) => facts()?.resets[resetKey(account, at, text)] ?? null,
    limitReopenedAt: (key, at, resetsAt, project, name) => limitReopenedAt(facts()?.limits[key] ?? null, at, resetsAt, run(project, name)?.model ?? null),
    limitsUnread: (project, name) => run(project, name)?.limitsUnread,
    accountsRead: () => facts()?.accountsRead === true,
    packagesBlocked: (project) => facts()?.projects[project]?.packagesBlocked === true,
    packagesPause: (project) => facts()?.projects[project]?.packagesPause,
    trackerMissing: (project) => facts()?.projects[project]?.trackerMissing,
  }
}
