import type { SessionView } from '../state.js'
import type { RunnerDeps } from './runner.js'

/** How long a finished session's task stays in the facts after its last activity: the chain's cleanup after Done reads it. */
export const RECENT_MS = 24 * 60 * 60_000

export interface ScopeInput {
  views: readonly SessionView[]
  /** The machine's launches: the older sessions of a task kept go with it. */
  journal: ReadonlyArray<{ sessionId: string; task: string }>
  /** The hub asks about the task: its trackers list it, a chain has it current, it is a fix, a carry or a chat. */
  asked: (task: string) => boolean
  now: number
}

/** The tasks and the sessions a machine elsewhere tells its hub of (`docs/machines.md`, "What a machine elsewhere tells"). */
export interface FactsScope {
  task(task: string): boolean
  session(sessionId: string): boolean
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
