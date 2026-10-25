import { isOwnName } from '../../../src/chain/fix.js'
import { withWaiting } from '../../../src/chain/order.js'
import type { ChainBlock } from '../state.js'

/** An open task of the chain's order; the fix and carry sessions are open and have no place in it. */
export function inOrder(block: ChainBlock): boolean {
  return block.open && !isOwnName(block.id)
}

/** The displayed order, shared by the drag preview and the optimistic drop. */
export function withOrder(chain: ChainBlock[], order: string[]): ChainBlock[] {
  const byId = new Map(chain.map((block) => [block.id, block]))
  const open = order.filter((id) => byId.has(id))
  if (open.length !== chain.filter(inOrder).length) return chain
  const locked = chain.filter((block) => block.locked).map((block) => block.id)
  const blockers = new Map(chain.map((block) => [block.id, block.blockedBy]))
  const placed = withWaiting(open, locked, blockers).map((id) => byId.get(id)!)
  return [...chain.filter((block) => !inOrder(block) && !block.locked), ...placed]
}
