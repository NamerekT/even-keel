import type { SessionView } from '../../src/state.js'
import type { Task } from '../../src/tracker/model.js'
import type { BlockLamp } from './state.js'
import { needsReply } from './completion.js'

/** The tracker's status first: a finished session lights a task done only when the task is done. */
export function taskLamp(task: Task | undefined, session: SessionView | null, refused = false): BlockLamp {
  if (task?.status.category === 'Won') return 'done'
  if (task?.status.category === 'Lost') return 'canceled'
  if (refused && (session === null || !needsReply(session))) return 'error'
  if (session === null) return task?.status.category === 'UnStarted' ? 'backlog' : 'ahead'
  if (session.checkpoint && (session.lamp === 'waiting' || session.lamp === 'finished')) return 'handoff'
  return session.lamp === 'finished' ? 'stopped' : session.lamp
}
