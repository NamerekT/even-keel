import { notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import { session } from './fakeSessions.js'

/**
 * A move on a task's start the tracker refused (BTN-554): `statusMove` — the profile's, `statusMove-source` — the
 * project's own; `statusMove-done` — a merged task whose chosen done status the tracker refused.
 */
export function withMoveFailure(state: EvenKeelState, mode: string): EvenKeelState {
  const task = 'ABC-5'
  const level = mode === 'statusMove-source' ? 'source' : 'profile'
  const failure = mode === 'statusMove-done'
    ? { completionFailures: { ABC: [notice('tracker.completeRefused', { task, status: 'Done', level }, { detail: 'huly: HTTP 403: The status Done needs a reviewer' })] } }
    : { moveFailures: { ABC: [notice('statusMove.refused', { task, status: 'In Progress', setting: 'start', level }, { detail: 'huly: HTTP 403: Not allowed to change the status' })] } }
  return { ...state, trackers: state.trackers.map((each) => (each.projects.includes('ABC') ? { ...each, ...failure } : each)) }
}

/** A merged task refused by a workflow validator, optionally with a long response or a real session question. */
export function withCompletionFailure(state: EvenKeelState, mode: string): EvenKeelState {
  const task = 'ABC-5'
  const waiting = session(task, 61_000, 'waiting')
  const question = mode === 'completion-question'
  const detail = mode === 'completion-long'
    ? `jira: HTTP 400: Due date required. ${'RequiredFieldWithALongName'.repeat(12)}: Set the field before closing this task.`
    : 'jira: HTTP 400: Нужен срок; duedate: Укажите срок исполнения'
  return {
    ...state,
    sessions: state.sessions.map((each) => each.task === task ? { ...waiting, asking: question, ask: question ? waiting.ask : null, stage: null, action: null } : each),
    trackers: state.trackers.map((each) => !each.projects.includes('ABC') ? each : {
      ...each, completionFailures: { ABC: [notice('tracker.completeRefused', { task }, { detail })] },
    }),
  }
}
