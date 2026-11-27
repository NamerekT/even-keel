export type Blockers = ReadonlyMap<string, readonly string[]>

export interface Bounds {
  min: number
  max: number
}

export interface Point {
  x: number
  y: number
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export function dropBounds(order: string[], blockers: Blockers, from: number, pinned: number): Bounds {
  const id = order[from]!
  const own = new Set(blockers.get(id) ?? [])
  let min = pinned
  let max = order.length - 1
  for (const [index, other] of order.entries()) {
    if (own.has(other)) min = Math.max(min, index > from ? index : index + 1)
    if (blockers.get(other)?.includes(id)) max = Math.min(max, index > from ? index - 1 : index)
  }
  return { min, max }
}

export function clampDrop(bounds: Bounds, target: number, from: number): number {
  if (bounds.min > bounds.max) return from
  return Math.min(bounds.max, Math.max(bounds.min, target))
}

export function relatives(order: string[], blockers: Blockers, id: string): { blockers: string[]; dependents: string[] } {
  const own = blockers.get(id) ?? []
  return {
    blockers: order.filter((other) => own.includes(other)),
    dependents: order.filter((other) => blockers.get(other)?.includes(id)),
  }
}

/** A transform past the list's edge grows the page, and the page shrinks back on drop: the scroll jumps. */
export function clampShift(box: Box, area: { width: number; height: number }, shift: Point): Point {
  return {
    x: Math.min(area.width - box.left - box.width, Math.max(-box.left, shift.x)),
    y: Math.min(area.height - box.top - box.height, Math.max(-box.top, shift.y)),
  }
}

/**
 * The top of each card once the cards stand in `order` (indices into `boxes`): each keeps its own height
 * and the gaps between places stay, so a milestone divider stays between the same places.
 */
export function stackedTops(boxes: Box[], order: number[]): number[] {
  const tops = new Array<number>(boxes.length)
  let top = boxes[0]?.top ?? 0
  for (const [place, index] of order.entries()) {
    tops[index] = top
    const next = boxes[place + 1]
    if (next !== undefined) top += boxes[index]!.height + next.top - boxes[place]!.top - boxes[place]!.height
  }
  return tops
}

/**
 * How far each row stands from its own place while `dragged` is held `shift` away and the rows preview `preview`
 * (`rows` — their order before the drag, `boxes` — their boxes in it). The other rows move only up or down: a locked
 * row keeps its indent wherever it goes (BTN-1767). Rows that stay put are left out.
 */
export function dragOffsets(boxes: Box[], rows: string[], preview: string[], dragged: string, shift: Point): Map<string, Point> {
  const tops = stackedTops(
    boxes,
    preview.map((id) => rows.indexOf(id)),
  )
  const offsets = new Map<string, Point>()
  for (const [index, id] of rows.entries()) {
    if (id !== dragged && tops[index] !== boxes[index]!.top) offsets.set(id, { x: 0, y: tops[index]! - boxes[index]!.top })
  }
  offsets.set(dragged, shift)
  return offsets
}

/** A row of the list and its top in the list's layout. */
export interface Row {
  id: string
  top: number
}

export interface RowShift {
  id: string
  /** How far the row stands from where it stood: it starts there and glides to `translate: none`. */
  shift: number
  /** The row that changed its place, drawn over the rows it passes. */
  lifted: boolean
}

/**
 * The FLIP of an order the server changed (BTN-1612): the rows on screen before and after whose place among those rows
 * changed. A row that came or went, or that only moved because one did, is not among them: its motion is its own.
 * The rows out of the longest run that kept its order are the lifted ones, so of two that swap the one going up is.
 */
export function reorderShifts(before: readonly Row[], after: readonly Row[], still: boolean): RowShift[] {
  if (still) return []
  const tops = new Map(before.map((row) => [row.id, row.top]))
  const common = after.filter((row) => tops.has(row.id))
  const ids = new Set(common.map((row) => row.id))
  const ranks = new Map(before.filter((row) => ids.has(row.id)).map((row, rank) => [row.id, rank]))
  const sequence = common.map((row) => ranks.get(row.id)!)
  const kept = longestRising(sequence)
  return common.flatMap((row, rank) => {
    const shift = tops.get(row.id)! - row.top
    if (sequence[rank] === rank || Math.abs(shift) < 1) return []
    return [{ id: row.id, shift, lifted: !kept.has(rank) }]
  })
}

/** The places of the longest rising run of `values`; of equal runs, the one ending lowest. */
function longestRising(values: readonly number[]): Set<number> {
  const tails: number[] = []
  const previous = new Array<number>(values.length).fill(-1)
  for (const [index, value] of values.entries()) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (values[tails[middle]!]! < value) low = middle + 1
      else high = middle
    }
    if (low > 0) previous[index] = tails[low - 1]!
    tails[low] = index
  }
  const run = new Set<number>()
  for (let at = tails.at(-1) ?? -1; at >= 0; at = previous[at]!) run.add(at)
  return run
}

export function nearestIndex(centers: Point[], point: Point): number {
  let best = 0
  let bestDistance = Infinity
  for (const [index, center] of centers.entries()) {
    const distance = Math.hypot(center.x - point.x, center.y - point.y)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}
