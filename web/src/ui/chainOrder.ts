import { isCarryName, isFixName, isOwnName } from '../../../src/chain/fix.js'
import { withWaiting } from '../../../src/chain/order.js'
import type { ChainBlock } from '../state.js'
import { underWay } from './runningGroup.js'

/** An open task of the chain's order; the fix and carry sessions are open and have no place in it. */
export function inOrder(block: ChainBlock): boolean {
  return block.open && !isOwnName(block.id)
}

/**
 * How many tasks lead the order and stay there as one group: every lane's current one, or the one a running fix of main
 * interrupted (BTN-1611).
 */
export function pinnedHead(open: ChainBlock[]): number {
  const free = open.findIndex((block) => !block.current && !block.interrupted)
  return free < 0 ? open.length : free
}

/** The displayed order, shared by the drag preview and the optimistic drop. */
export function withOrder(chain: ChainBlock[], order: string[]): ChainBlock[] {
  const byId = new Map(chain.map((block) => [block.id, block]))
  const open = order.filter((id) => byId.has(id))
  if (open.length !== chain.filter(inOrder).length) return underWayFirst(chain)
  const locked = chain.filter((block) => block.locked).map((block) => block.id)
  const blockers = new Map(chain.map((block) => [block.id, block.blockedBy]))
  const ancestors = new Map(chain.map((block) => [block.id, block.ancestors ?? []]))
  const rows = withWaiting(open, locked, blockers, ancestors).map((id) => byId.get(id)!)
  const own = chain.filter((block) => block.open && isOwnName(block.id))
  placeOwn(chain, own, rows)
  return underWayFirst([...chain.filter((block) => !block.open && !block.locked), ...rows])
}

/**
 * The head of the open rows as the page shows it (BTN-1617): what a lane runs now — a fix or a carry first, then the
 * tasks in their order — as one run for the group "Under way", and under it the rows that lead the order but stand:
 * the task a fix interrupted, a paused lane's task whose session stands (`halted`), a carry asked for. The dispatcher's
 * order keeps the interrupted task first; only the page moves it, so a drop lands below it.
 */
export function underWayFirst(blocks: ChainBlock[]): ChainBlock[] {
  const start = blocks.findIndex((block) => block.open || block.locked)
  if (start < 0) return blocks
  let end = start
  while (end < blocks.length && atHead(blocks[end]!)) end++
  const head = blocks.slice(start, end)
  const running = head.filter(underWay)
  if (running.length === 0) return blocks
  const own = running.filter((block) => isOwnName(block.id))
  const tasks = running.filter((block) => !isOwnName(block.id))
  const standing = head.filter((block) => !underWay(block))
  return [...blocks.slice(0, start), ...own, ...tasks, ...standing, ...blocks.slice(end)]
}

function atHead(block: ChainBlock): boolean {
  return block.open && (block.current || block.interrupted === true || isOwnName(block.id))
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
