import { useEffect, useState } from 'react'
import type { TaskHistory } from '../../../src/state.js'
import { useLive } from '../live/context.js'
import type { ChainBlock } from '../state.js'

/**
 * The block of an open panel with the runs and sessions the state leaves out (BTN-1256): asked for once, only for a task
 * the state names in `ranAt`, or one with runs and no session — a machine elsewhere tells its hub of a task's sessions
 * only for a day after their last move (BTN-1561).
 */
export function useTaskHistory(block: ChainBlock): ChainBlock {
  const { state, query } = useLive()
  const left = state?.ranAt?.[block.id] !== undefined || (block.session === null && block.sessions.length > 0)
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

/** The block with a task's history where the state gave it none; the newest run's session is its session. */
export function withHistory(block: ChainBlock, history: TaskHistory): ChainBlock {
  const given = block.sessions.length > 0
  if ((given && block.session !== null) || (!given && history.runs.length === 0)) return block
  const sessions = given ? block.sessions : history.runs
  const newest = sessions[0]!.sessionId
  return { ...block, sessions, session: block.session ?? history.sessions.find((view) => view.sessionId === newest) ?? null }
}
