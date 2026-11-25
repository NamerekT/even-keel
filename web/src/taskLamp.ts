import type { ActiveChainView, SessionView } from '../../src/state.js'
import type { Task } from '../../src/tracker/model.js'
import type { BlockLamp } from './state.js'
import { needsReply } from './completion.js'

/**
 * Whether a lane waits out a spent limit for the task (BTN-1702): a wait not acted on yet, and not a temporary model
 * error, as the README badge reads it (`src/badge/collect.ts`).
 */
export function limitHeld(lanes: readonly Pick<ActiveChainView, 'current'>[], task: string): boolean {
  return lanes.some(({ current }) => current?.task === task && current.limit !== undefined && current.limit.acted === null && current.limit.transient !== true)
}

/**
 * The tracker's status first: a finished session lights a task done only when the task is done. A session ended on a
 * limit the chain waits out (`held`) lights the limit, not a stopped session.
 */
export function taskLamp(task: Task | undefined, session: SessionView | null, refused = false, held = false): BlockLamp {
  if (task?.status.category === 'Won') return 'done'
  if (task?.status.category === 'Lost') return 'canceled'
  if (refused && (session === null || !needsReply(session))) return 'error'
  if (held && (session === null || !needsReply(session))) return 'limit'
  if (session === null) return task?.status.category === 'UnStarted' ? 'backlog' : 'ahead'
  if (session.checkpoint && (session.lamp === 'waiting' || session.lamp === 'finished')) return 'handoff'
  return session.lamp === 'finished' ? 'stopped' : session.lamp
}
