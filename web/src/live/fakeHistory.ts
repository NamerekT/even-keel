import type { EvenKeelState, TaskHistory } from '../../../src/state.js'

/** The history `?history=left` took out of the state, by task. */
const leftOut = new Map<string, TaskHistory>()

/**
 * `?history=left`: the state as the service sends it once the closed tasks' history is old (BTN-1256): their runs and
 * sessions are out, the newest launch of each in `ranAt`; `history/task` gives them back.
 */
export function withHistoryLeft(state: EvenKeelState): EvenKeelState {
  const closed = new Set(state.tasks.filter((task) => task.status.category === 'Won' || task.status.category === 'Lost').map((task) => task.id))
  const taskSessions: EvenKeelState['taskSessions'] = {}
  const ranAt: Record<string, string> = {}
  for (const [id, runs] of Object.entries(state.taskSessions)) {
    if (!closed.has(id) || runs.length === 0) {
      taskSessions[id] = runs
      continue
    }
    leftOut.set(id, { runs, sessions: state.sessions.filter((view) => runs.some((run) => run.sessionId === view.sessionId)) })
    ranAt[id] = runs[0]!.at
  }
  const gone = new Set([...leftOut.values()].flatMap((history) => history.sessions.map((view) => view.sessionId)))
  return { ...state, taskSessions, ranAt, sessions: state.sessions.filter((view) => !gone.has(view.sessionId)) }
}

/** What the service's `history/task` answers on `dev:fake`. */
export function fakeTaskHistory(state: EvenKeelState, task: string): TaskHistory {
  const left = leftOut.get(task)
  if (left !== undefined) return left
  const runs = state.taskSessions[task] ?? []
  return { runs, sessions: state.sessions.filter((view) => runs.some((run) => run.sessionId === view.sessionId)) }
}
