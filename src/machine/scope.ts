import { isCarryName, isFixName } from '../chain/fix.js'
import { isChatName } from '../chats/model.js'
import type { SessionView } from '../state.js'
import type { HubBrief } from './brief.js'
import type { RunnerDeps } from './runner.js'
import type { TaskSessionsHere } from './services.js'

/** How long a finished session's task stays in the facts after its last activity: the chain's cleanup after Done reads it. */
export const RECENT_MS = 24 * 60 * 60_000

export interface ScopeInput {
  views: readonly SessionView[]
  /** The machine's launches: the older sessions of a task kept go with it. */
  journal: ReadonlyArray<{ sessionId: string; task: string }>
  /** The hub asks about the task (`briefAsks`). */
  asked: (task: string) => boolean
  now: number
}

/** The tasks and the sessions a machine elsewhere tells its hub of (`docs/machines.md`, "What a machine elsewhere tells"). */
export interface FactsScope {
  task(task: string): boolean
  session(sessionId: string): boolean
}

/**
 * Whether the hub asks about a task (`ScopeInput.asked`): its trackers list it open, a chain has it current, keep-warm
 * pings it, or it is a fix, a carry or a chat. A closed task the lists still hold — the chain's archive — is not asked
 * about: on the computer of a moved hub that archive is hundreds of tasks with all their sessions (BTN-1563).
 */
export function briefAsks({ tasks, closed = {}, current, warm }: Pick<HubBrief, 'tasks' | 'closed' | 'current' | 'warm'>): (task: string) => boolean {
  const done = new Set(Object.values(closed).flat())
  const asked = new Set([...Object.values(tasks).flat().filter((task) => !done.has(task)), ...Object.keys(current), ...warm.map((each) => each.task)])
  return (task) => asked.has(task) || isChatName(task) || isFixName(task) || isCarryName(task)
}

const recent = (view: SessionView, now: number): boolean => view.lastActivityAt !== null && now - Date.parse(view.lastActivityAt) < RECENT_MS

/**
 * The facts of a machine elsewhere grow with what the hub asks about, never with the history of its account folders
 * (BTN-1559): a task the hub asks about, one with a session not finished, and one whose session was active lately.
 */
export function factsScope({ views, journal, asked, now }: ScopeInput): FactsScope {
  const tasks = new Set<string>()
  const sessions = new Set<string>()
  const keeps = (task: string): boolean => {
    if (tasks.has(task)) return true
    if (!asked(task)) return false
    tasks.add(task)
    return true
  }
  for (const view of views) if (view.lamp !== 'finished' || recent(view, now)) tasks.add(view.task)
  for (const view of views) if (keeps(view.task)) sessions.add(view.sessionId)
  for (const entry of journal) if (keeps(entry.task)) sessions.add(entry.sessionId)
  return { task: keeps, session: (sessionId) => sessions.has(sessionId) }
}

export interface HereInput {
  views: readonly SessionView[]
  /** The account folder of a session: its agent's, else the one its transcript is in. */
  owners: (sessionId: string) => string | undefined
  compactions: Record<string, number>
}

/**
 * A task's sessions whole for the hub's history window (BTN-1561): those of the task and those the hub's runs of it
 * name (a fix's run goes under the fix's name), with the parts of the facts `factsScope` leaves out of an old task.
 */
export function taskSessionsHere({ views, owners, compactions }: HereInput, task: string, sessionIds: string[]): TaskSessionsHere {
  const ids = new Set(sessionIds)
  const sessions = Object.fromEntries(views.filter((view) => view.task === task || ids.has(view.sessionId)).map((view) => [view.sessionId, view]))
  for (const sessionId of Object.keys(sessions)) ids.add(sessionId)
  const owned: Record<string, string> = {}
  for (const sessionId of ids) {
    const key = owners(sessionId)
    if (key !== undefined) owned[sessionId] = key
  }
  return { sessions, owners: owned, compactions: within(compactions, (sessionId) => ids.has(sessionId)) }
}

const within = <V>(record: Record<string, V>, keep: (key: string) => boolean): Record<string, V> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => keep(key)))

/**
 * The runner's reads cut to the scope, read once per computation of the facts; `undefined` — the hub's own machine,
 * which tells everything: its facts never cross the network.
 */
export function scopedDeps(deps: RunnerDeps, scope: () => FactsScope | undefined): RunnerDeps {
  const { sessions, mailbox, owners, compactions } = deps
  return {
    ...deps,
    tasks: () => {
      const cut = scope()
      return cut === undefined ? deps.tasks() : deps.tasks().filter(({ task }) => cut.task(task))
    },
    ...(sessions !== undefined && {
      sessions: () => {
        const cut = scope()
        return cut === undefined ? sessions() : sessions().filter((view) => cut.session(view.sessionId))
      },
    }),
    ...(mailbox !== undefined && { mailbox: () => { const cut = scope(); return cut === undefined ? mailbox() : within(mailbox(), cut.session) } }),
    ...(owners !== undefined && { owners: () => { const cut = scope(); return cut === undefined ? owners() : within(owners(), cut.session) } }),
    ...(compactions !== undefined && { compactions: () => { const cut = scope(); return cut === undefined ? compactions() : within(compactions(), cut.session) } }),
  }
}
