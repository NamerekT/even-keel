import type { BlockLamp } from '../state.js'

/** One look at the chain: what the page last showed the user, or shows now. */
export interface Frame<T> {
  /** The chain outside the folded archive, in order. */
  order: string[]
  items: ReadonlyMap<string, T>
  /** What is on screen: a folded milestone is not, an unfolded archive page is. */
  shown: ReadonlySet<string>
  /** Closed tasks of the whole chain, the archived ones included. */
  closed: ReadonlySet<string>
  current: string | null
}

export type Beat = 'finish' | 'leave' | 'enter' | 'take'

export interface Leaving<T> {
  item: T
  /** The task it stood after that is still on screen; `null` — the top of the list. */
  after: string | null
  archived: boolean
}

export interface Away {
  entered: number
  archived: number
  removed: number
}

export interface Motion<T> {
  entered: string[]
  finished: string[]
  taken: string | null
  leaving: Leaving<T>[]
  /** Too much changed out of sight: no beats, a summary and a soft mark on the new tasks instead. */
  quiet: Away | null
  /** When each beat starts, so a handover reads as finish, archive, take rather than one jump. */
  delays: Partial<Record<Beat, number>>
}

export interface Slot<T> {
  block: T
  leaving: boolean
}

export const BEAT_MS = 400
export const BEAT_LENGTH_MS = 1_500
export const QUIET_MS = 6_000
const QUIET_OVER = 5
const BEATS: Beat[] = ['finish', 'leave', 'enter', 'take']

/** The net change between two looks at the chain; what came and went in between is not in it. */
export function motionOf<T extends { id: string; lamp: BlockLamp }>(
  prev: Frame<T>,
  next: Frame<T>,
  skip: ReadonlySet<string>,
): Motion<T> | null {
  const before = new Set(prev.order)
  const after = new Set(next.order)
  const entered = next.order.filter((id) => !before.has(id) && next.shown.has(id) && !skip.has(id))
  const leaving = prev.order
    .filter((id) => !after.has(id) && prev.shown.has(id) && !next.shown.has(id))
    .map((id) => ({ item: prev.items.get(id)!, after: anchorOf(prev.order, id, next.shown), archived: next.closed.has(id) }))
  const finished = next.order.filter(
    (id) => before.has(id) && next.shown.has(id) && next.items.get(id)!.lamp === 'done' && prev.items.get(id)!.lamp !== 'done',
  )
  const taken = next.current !== null && next.current !== prev.current && next.shown.has(next.current) ? next.current : null

  if (entered.length + leaving.length > QUIET_OVER) {
    const archived = leaving.filter((each) => each.archived).length
    const quiet = { entered: entered.length, archived, removed: leaving.length - archived }
    return { entered, finished: [], taken: null, leaving: [], quiet, delays: {} }
  }
  if (entered.length + leaving.length + finished.length === 0 && taken === null) return null

  const present: Record<Beat, boolean> = { finish: finished.length > 0, leave: leaving.length > 0, enter: entered.length > 0, take: taken !== null }
  const delays: Partial<Record<Beat, number>> = {}
  for (const beat of BEATS.filter((each) => present[each])) delays[beat] = Object.keys(delays).length * BEAT_MS
  return { entered, finished, taken, leaving, quiet: null, delays }
}

/** How long the page keeps the marks of a motion. */
export function motionSpan(motion: Motion<unknown>): number {
  if (motion.quiet !== null) return QUIET_MS
  return Math.max(0, ...Object.values(motion.delays)) + BEAT_LENGTH_MS
}

/** The sections with the leaving tasks back where they stood, until they fold away. */
export function placeLeaving<T extends { id: string }>(sections: T[][], leaving: Leaving<T>[]): Slot<T>[][] {
  const placed = sections.map((blocks) => blocks.map((block) => ({ block, leaving: false })))
  const top = leaving.filter((each) => each.after === null).map((each) => ({ block: each.item, leaving: true }))
  for (const section of placed) {
    for (let index = section.length - 1; index >= 0; index--) {
      const anchor = section[index]!
      if (anchor.leaving) continue
      const kept = leaving.filter((each) => each.after === anchor.block.id).map((each) => ({ block: each.item, leaving: true }))
      section.splice(index + 1, 0, ...kept)
    }
  }
  if (placed.length > 0) placed[0]!.unshift(...top)
  return placed
}

function anchorOf(order: string[], id: string, shown: ReadonlySet<string>): string | null {
  for (let index = order.indexOf(id) - 1; index >= 0; index--) {
    if (shown.has(order[index]!)) return order[index]!
  }
  return null
}
