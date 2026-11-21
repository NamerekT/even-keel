import { blockMetered, type ChainBlock } from '../state.js'

/** How many rows a milestone of the chain shows before its "N more" button (BTN-1188). */
export const CHAIN_PAGE = 50
/** How many rows a press of the button adds. */
export const CHAIN_MORE = 16

export interface MilestonePage<T> {
  /** The rows above the button, in the chain's order. */
  head: T[]
  /** Rows past the cut that never hide (a live session, a question, an error, the current task): they stand under the button. */
  kept: T[]
  /** How many rows are behind the button, the kept ones and the uncounted ones aside. */
  hidden: number
  /** How many rows the next press adds. */
  next: number
}

export interface PageRules<T> {
  keeps: (block: T) => boolean
  /** A row the page does not count (the backlog's ghost): it shows only before the cut. */
  counts?: (block: T) => boolean
  /** The row the address points at: the page opens as many steps as it takes to show it. */
  focus?: string
}

/** A row that is never behind the button: the current task, a live session, a question or an error. */
export function staysInView(block: Pick<ChainBlock, 'current' | 'question' | 'lamp' | 'session'>): boolean {
  return block.current || block.question || block.lamp === 'error' || blockMetered(block)
}

/** One milestone's rows cut at `CHAIN_PAGE` plus `more` presses of `CHAIN_MORE`. */
export function milestonePage<T extends { id: string }>(blocks: T[], more: number, rules: PageRules<T>): MilestonePage<T> {
  const counts = rules.counts ?? (() => true)
  const counted = blocks.filter(counts)
  const target = rules.focus === undefined ? -1 : counted.findIndex((block) => block.id === rules.focus)
  const steps = Math.max(more, target < CHAIN_PAGE ? 0 : Math.ceil((target + 1 - CHAIN_PAGE) / CHAIN_MORE))
  const limit = CHAIN_PAGE + steps * CHAIN_MORE
  const head: T[] = []
  const kept: T[] = []
  let seen = 0
  let hidden = 0
  for (const block of blocks) {
    if (!counts(block)) {
      if (seen < limit) head.push(block)
    } else if (seen++ < limit) head.push(block)
    else if (rules.keeps(block)) kept.push(block)
    else hidden++
  }
  if (hidden === 0) return { head: blocks, kept: [], hidden: 0, next: 0 }
  return { head, kept, hidden, next: Math.min(CHAIN_MORE, hidden) }
}

/**
 * The whole open order after a drop among the rows in view: the moved task goes right after the row it was dropped
 * under (before the row it was dropped over when it went to the top), and every task out of view keeps its place.
 */
export function droppedOrder(full: readonly string[], dropped: readonly string[], moved: string): string[] {
  const at = dropped.indexOf(moved)
  if (at < 0 || !full.includes(moved)) return [...full]
  const rest = full.filter((id) => id !== moved)
  const above = dropped[at - 1]
  const below = dropped[at + 1]
  const index = above !== undefined ? rest.indexOf(above) + 1 : below !== undefined ? rest.indexOf(below) : -1
  if (index < 0) return [...full]
  return rest.toSpliced(index, 0, moved)
}
