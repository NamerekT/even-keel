import { accountAt, type AccountLedger } from '../account/ledger.js'
import { accountId, type AccountView } from '../account/model.js'
import type { LimitsWait, ModelWeekHold } from '../chain/model.js'
import type { AccountNow, HandoffSession, LimitedSession } from '../chain/relay.js'
import { limitReopenedAt, type RateLimits } from '../limits/model.js'
import type { AccountTie } from '../limits/polls.js'
import type { OverageSession } from '../limits/overage-session.js'
import type { UsageHealth } from '../limits/usage.js'
import type { Notice } from '../notice/notice.js'
import type { SessionMail } from '../sessions/mail.js'
import type { BranchDiff, FoundRepository, PackagesHeld, SessionView, TaskWork } from '../state.js'
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
  sessionBlock?: Notice
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
  /** What holds it while blocked (BTN-1524); absent from a machine older than it. */
  packagesHeld?: PackagesHeld
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
  /** Page state, keyed by session id; absent on a machine with no session monitor. */
  sessions?: Record<string, SessionView>
  mailbox?: Record<string, SessionMail>
  /** The accounts panel (`AccountWatcher.view`, its `missing` read with it); absent on a machine with no account watcher. */
  panel?: AccountView
  /** `usage` by account folder, for the folders of `limits`. */
  usage?: Record<string, UsageHealth>
  /** By session id, for the sessions the page may list: the account folder of its agent, else of its transcript. */
  owners?: Record<string, string>
  /** By session id: the compactions counted in its transcript, only the sessions with any. */
  compactions?: Record<string, number>
  /** By account folder, the Claude folders signed in to claude.ai: whose account it is and whether it is polled (BTN-991). */
  identities?: Record<string, AccountTie>
  /** By project, what each task's working folder holds (`TaskWorks.view`): the page's task rows. */
  works?: Record<string, Record<string, TaskWork>>
  /** By project, the lines each task's branch changed (`TaskWorks.diffs`): the chat's foot. */
  diffs?: Record<string, Record<string, BranchDiff>>
  /** By project without git, the repository its folder has become (`GitFound.view`, BTN-1025). */
  gitFound?: Record<string, FoundRepository>
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

const SECTIONS = ['tasks', 'projects', 'ledger', 'limits', 'resets', 'sessions', 'mailbox', 'usage', 'owners', 'compactions', 'identities', 'works', 'diffs', 'gitFound'] as const
type Section = (typeof SECTIONS)[number]

/** The entries of one section that changed since the last post: `set` — new or changed, `gone` — no longer there. */
export interface SectionPatch<V> {
  set?: Record<string, V>
  gone?: string[]
}

/** `panel` goes whole when anything in it changed: the page reads it as one view. */
export type FactsPatch = Partial<Pick<MachineFacts, 'sessionsRead' | 'accountsRead' | 'panel'>> & { [K in Section]?: SectionPatch<NonNullable<MachineFacts[K]>[string]> }

const hasJson = (value: unknown): boolean => typeof value === 'object' && value !== null && typeof (value as { toJSON?: unknown }).toJSON === 'function'

/**
 * Whether two values would be posted as the same JSON, without writing them out: a computation of the facts compares
 * every entry of every section. The order of an object's keys does not count; a key whose value is `undefined` is absent.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (hasJson(a) || hasJson(b)) return JSON.stringify(a) === JSON.stringify(b)
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((each, index) => sameJson(each, b[index]))
  }
  const was = a as Record<string, unknown>
  const now = b as Record<string, unknown>
  let held = 0
  for (const key of Object.keys(was)) {
    if (was[key] === undefined) continue
    held += 1
    if (!sameJson(was[key], now[key])) return false
  }
  for (const key of Object.keys(now)) if (now[key] !== undefined) held -= 1
  return held === 0
}

/** `undefined` — nothing changed. */
export function patchOf(before: MachineFacts, after: MachineFacts): FactsPatch | undefined {
  const patch: FactsPatch = {}
  if (before.sessionsRead !== after.sessionsRead) patch.sessionsRead = after.sessionsRead
  if (before.accountsRead !== after.accountsRead) patch.accountsRead = after.accountsRead
  if (after.panel !== undefined && !sameJson(before.panel, after.panel)) patch.panel = after.panel
  for (const section of SECTIONS) {
    const was = (before[section] ?? {}) as Record<string, unknown>
    const now = (after[section] ?? {}) as Record<string, unknown>
    const set: Record<string, unknown> = {}
    for (const key of Object.keys(now)) if (!Object.hasOwn(was, key) || !sameJson(was[key], now[key])) set[key] = now[key]
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
  if (patch.panel !== undefined) next.panel = patch.panel
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
  | 'sessionsRead' | 'reportedTree' | 'account' | 'accountAt' | 'launchBlock' | 'sessionBlock' | 'limitReset' | 'modelWeek' | 'limitResetAfter' | 'limitReopenedAt'
  | 'limitsUnread' | 'accountsRead' | 'packagesBlocked' | 'packagesHeld' | 'packagesPause' | 'trackerMissing'
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
    sessionBlock: (name) => task(name).sessionBlock,
    limitReset: (project, name) => run(project, name)?.limitReset ?? null,
    modelWeek: (project, name) => run(project, name)?.modelWeek ?? null,
    limitResetAfter: (account, at, text) => facts()?.resets[resetKey(account, at, text)] ?? null,
    limitReopenedAt: (key, at, resetsAt, project, name) => limitReopenedAt(facts()?.limits[key] ?? null, at, resetsAt, run(project, name)?.model ?? null),
    limitsUnread: (project, name) => run(project, name)?.limitsUnread,
    accountsRead: () => facts()?.accountsRead === true,
    packagesBlocked: (project) => facts()?.projects[project]?.packagesBlocked === true,
    packagesHeld: (project) => {
      const known = facts()?.projects[project]
      return known?.packagesBlocked === true ? (known.packagesHeld ?? { packages: [] }) : undefined
    },
    packagesPause: (project) => facts()?.projects[project]?.packagesPause,
    trackerMissing: (project) => facts()?.projects[project]?.trackerMissing,
  }
}
