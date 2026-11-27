import { useEffect, useState } from 'react'
import type { TaskSession } from '../../../src/chain/launches.js'
import type { TaskHistory } from '../../../src/state.js'
import { useLive } from '../live/context.js'
import type { ChainBlock } from '../state.js'

/**
 * Whether the panel asks for the task's history: the state names it in `ranAt`, it has runs and no session — a machine
 * elsewhere tells its hub of a task's sessions only for a day after their last move (BTN-1561) — or a run whose account
 * the machine's facts no longer tell (BTN-1800).
 */
export function asksHistory(block: ChainBlock, ranAt: string | undefined): boolean {
  return ranAt !== undefined || (block.sessions.length > 0 && (block.session === null || block.sessions.some((run) => run.account == null)))
}

/** The block of an open panel with the runs, sessions and accounts the state leaves out (BTN-1256), asked for once. */
export function useTaskHistory(block: ChainBlock): ChainBlock {
  const { state, query } = useLive()
  const left = asksHistory(block, state?.ranAt?.[block.id])
  const [history, setHistory] = useState<{ task: string; answer: TaskHistory } | null>(null)
  useEffect(() => {
    if (!left) return
    let alive = true
    query<TaskHistory>('history/task', { task: block.id })
      .then((answer) => alive && setHistory({ task: block.id, answer }))
      .catch((error: unknown) => console.warn(`history/task ${block.id}: ${error instanceof Error ? error.message : String(error)}`))
    return () => {
      alive = false
    }
  }, [block.id, left])
  return history?.task === block.id ? withHistory(block, history.answer) : block
}

/**
 * The block with a task's history where the state gave it none; the newest run's session is its session. A run the
 * state gave without an account takes the history's account, agent and compactions of it.
 */
export function withHistory(block: ChainBlock, history: TaskHistory): ChainBlock {
  const given = block.sessions.length > 0
  if (!given && history.runs.length === 0) return block
  const sessions = given ? withAccounts(block.sessions, history.runs) : history.runs
  if (sessions === block.sessions && block.session !== null) return block
  const newest = sessions[0]!.sessionId
  return { ...block, sessions, session: block.session ?? history.sessions.find((view) => view.sessionId === newest) ?? null }
}

function withAccounts(runs: TaskSession[], found: TaskSession[]): TaskSession[] {
  let changed = false
  const filled = runs.map((run) => {
    const there = run.account == null ? found.find((each) => each.sessionId === run.sessionId) : undefined
    if (there?.account == null) return run
    changed = true
    return {
      ...run,
      account: there.account,
      ...(run.agent === undefined && there.agent !== undefined && { agent: there.agent }),
      ...(run.compactions === undefined && there.compactions !== undefined && { compactions: there.compactions }),
    }
  })
  return changed ? filled : runs
}
