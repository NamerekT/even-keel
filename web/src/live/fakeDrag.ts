import type { EvenKeelState } from '../../../src/state.js'
import { task } from './fakeSessions.js'

/** One external blocker shared by several otherwise independent chain tasks. */
export function withDragPreview(state: EvenKeelState): EvenKeelState {
  const kept = state.chain.projects.ABC!
  const order = ['ABC-5', 'ABC-6', 'ABC-7', 'ABC-8', 'ABC-9', 'ABC-10', 'ABC-11', 'ABC-13']
  const milestone = 'v0.2 — удобство'
  const tasks = state.tasks.map((each) => order.includes(each.id) ? {
    ...each,
    milestone: { label: milestone, targetDate: null },
    blockedBy: ['ABC-7', 'ABC-9', 'ABC-11'].includes(each.id) ? ['ABC-16'] : [],
  } : each)
  return {
    ...state,
    tasks: [...tasks, task('ABC-16', 'Shared external blocker', 'In Progress', 'Active', [], milestone)],
    chain: { ...state.chain, projects: { ...state.chain.projects, ABC: { ...kept, order, waiting: ['ABC-16'] } } },
  }
}
