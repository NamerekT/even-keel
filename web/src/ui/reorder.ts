export type Blockers = ReadonlyMap<string, readonly string[]>

export interface Bounds {
  min: number
  max: number
}

export interface Point {
  x: number
  y: number
}

export interface BlockLink {
  from: number
  to: number
  adjacent: boolean
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

export function blockLinks(order: string[], blockers: Blockers): BlockLink[] {
  const position = new Map(order.map((id, index) => [id, index]))
  const links: BlockLink[] = []
  for (const [to, id] of order.entries()) {
    for (const blocker of blockers.get(id) ?? []) {
      const from = position.get(blocker)
      if (from !== undefined && from < to) links.push({ from, to, adjacent: to - from === 1 })
    }
  }
  return links.sort((a, b) => a.from - b.from || a.to - b.to)
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
