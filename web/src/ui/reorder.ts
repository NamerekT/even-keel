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
