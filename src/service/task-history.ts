import type { MachineFacts } from '../machine/facts.js'
import { allSessions, pageReads, type PageReads, type SessionReads } from '../machine/page.js'
import type { MachineHistory, TaskSessionsHere } from '../machine/services.js'

/** How long the history window waits for a machine elsewhere before it shows that machine's mirror alone. */
export const HISTORY_ASK_MS = 5_000

/** A machine elsewhere that has posted a snapshot since the hub started. */
export interface HistoryMirror {
  machine: string
  facts: () => MachineFacts | undefined
  page: PageReads
  /** Its history service; `undefined` — it is off the link. */
  history: MachineHistory | undefined
}

export interface HistoryReadsDeps {
  own: PageReads
  elsewhere: () => HistoryMirror[]
  log: (line: string) => void
  /** `HISTORY_ASK_MS` by default (tests). */
  waitMs?: number
}

/**
 * The sessions of every machine for a task's history window (BTN-1561): each machine elsewhere on the link is asked
 * for the task's sessions its facts leave out (`factsScope`), laid under its mirror; one off the link, failing or late
 * gives its mirror alone. The own machine's facts tell everything.
 */
export async function historyReads(deps: HistoryReadsDeps, task: string, sessionIds: string[]): Promise<SessionReads> {
  const waitMs = deps.waitMs ?? HISTORY_ASK_MS
  const pages = await Promise.all(
    deps.elsewhere().map(async (mirror) => {
      if (mirror.history === undefined) return mirror.page
      try {
        return withHere(mirror.facts, await within(mirror.history.task(task, sessionIds), waitMs))
      } catch (error) {
        deps.log(`machines: machine ${mirror.machine} did not give the sessions of ${task} for its history: ${error instanceof Error ? error.message : String(error)}`)
        return mirror.page
      }
    }),
  )
  return allSessions(() => [deps.own, ...pages])
}

/** The mirror's reads with what the machine gave of the task laid under its facts. */
function withHere(facts: () => MachineFacts | undefined, here: TaskSessionsHere): PageReads {
  return pageReads(() => {
    const told = facts()
    if (told === undefined) return undefined
    return {
      ...told,
      sessions: { ...here.sessions, ...told.sessions },
      owners: { ...here.owners, ...told.owners },
      compactions: { ...here.compactions, ...told.compactions },
    }
  })
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms)))
  try {
    return await Promise.race([promise, late])
  } finally {
    clearTimeout(timer)
  }
}
