import type { EvenKeelState } from '../../../src/state.js'

/** How long each order of `?chain=reorder` stands before the next one comes. */
export const REORDER_MS = 2_000

const MOVED = 'ABC-9'
/** The place it goes to: right after ABC-6, past ABC-7 and ABC-8. */
const UP = 2

/**
 * `?chain=reorder` (BTN-1612): an order changed elsewhere — another tab's drop, the phone, a rule. A step moves ABC-9
 * up past ABC-7 and ABC-8, the next one back under them, as the server's state would bring it.
 */
export function reorderStep(state: EvenKeelState): EvenKeelState {
  const kept = state.chain.projects.ABC
  if (kept === undefined || !kept.order.includes(MOVED)) return state
  const rest = kept.order.filter((id) => id !== MOVED)
  const at = kept.order.indexOf(MOVED) === UP ? UP + 2 : UP
  const order = [...rest.slice(0, at), MOVED, ...rest.slice(at)]
  return { ...state, chain: { ...state.chain, projects: { ...state.chain.projects, ABC: { ...kept, order } } } }
}
