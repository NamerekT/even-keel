import type { EvenKeelState } from '../../../src/state.js'
import { task } from './fakeSessions.js'

/** The v0.1 rows of ABC in three families that interleave: ABC-16 keeps 5 and 9, a new ABC-22 takes 6 and 8, ABC-17 takes 7. */
const PARENTS: Record<string, string> = { 'ABC-5': 'ABC-16', 'ABC-6': 'ABC-22', 'ABC-7': 'ABC-17', 'ABC-8': 'ABC-22', 'ABC-9': 'ABC-16' }

/** `?families=3`: three rails side by side on the chain, for their lanes at both widths (BTN-1162). */
export function withFamilies(state: EvenKeelState): EvenKeelState {
  const parent = { ...task('ABC-22', 'Шапка и статусы', 'In Progress', 'Active', [], 'v0.1 — каркас', { subtasks: 2 }), closedSubtasks: 0 }
  return {
    ...state,
    tasks: state.tasks.map((each) => (PARENTS[each.id] === undefined ? each : { ...each, parent: PARENTS[each.id]! })),
    parents: { ...state.parents, ABC: [...(state.parents?.ABC ?? []), parent] },
  }
}
