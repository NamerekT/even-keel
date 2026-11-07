import { isCarryName, isFixName, isOwnName } from '../../../src/chain/fix.js'
import { withWaiting } from '../../../src/chain/order.js'
import type { ChainBlock } from '../state.js'

/** An open task of the chain's order; the fix and carry sessions are open and have no place in it. */
export function inOrder(block: ChainBlock): boolean {
  return block.open && !isOwnName(block.id)
}

/** How many tasks lead the order and stay there: the current one, or the one a running fix of main interrupted. */
export function pinnedHead(open: ChainBlock[]): number {
  return open[0]?.current || open[0]?.interrupted ? 1 : 0
}

/** The displayed order, shared by the drag preview and the optimistic drop. */
export function withOrder(chain: ChainBlock[], order: string[]): ChainBlock[] {
  const byId = new Map(chain.map((block) => [block.id, block]))
  const open = order.filter((id) => byId.has(id))
  if (open.length !== chain.filter(inOrder).length) return chain
  const locked = chain.filter((block) => block.locked).map((block) => block.id)
  const blockers = new Map(chain.map((block) => [block.id, block.blockedBy]))
  const rows = withWaiting(open, locked, blockers).map((id) => byId.get(id)!)
  const own = chain.filter((block) => block.open && isOwnName(block.id))
  placeOwn(chain, own, rows)
  return [...chain.filter((block) => !block.open && !block.locked), ...rows]
}

/**
 * The fix and carry rows hold to a neighbour the way `chainBlocks` placed them: a fix stands right above the task it
 * interrupted, a carry asked for right after the task it waits on (the interrupted one, else the current one); a fix
 * that interrupted nothing and a carry that runs lead the chain.
 */
function placeOwn(chain: ChainBlock[], own: ChainBlock[], rows: ChainBlock[]): void {
  const interrupted = chain.find((block) => block.interrupted)
  const current = chain.find((block) => block.current && !isCarryName(block.id))
  let top = 0
  for (const block of own) {
    const below = isFixName(block.id) ? interrupted : undefined
    const above = isCarryName(block.id) && !block.current ? (interrupted ?? current) : undefined
    const at = below !== undefined ? rows.indexOf(below) : above !== undefined ? rows.indexOf(above) + 1 : -1
    if (at < 0) rows.splice(top++, 0, block)
    else {
      rows.splice(at, 0, block)
      if (at <= top) top++
    }
  }
}
