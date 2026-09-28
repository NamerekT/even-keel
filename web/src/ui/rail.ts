import type { Point } from './reorder.js'

export interface RailLink {
  from: number
  to: number[]
  lane: number
}

export function railLanes(links: { from: number; to: number }[]): RailLink[] {
  const byBlocker = new Map<number, number[]>()
  for (const { from, to } of links) byBlocker.set(from, [...(byBlocker.get(from) ?? []), to])
  const ends: number[] = []
  return [...byBlocker.entries()]
    .sort(([a], [b]) => a - b)
    .map(([from, targets]) => {
      const to = targets.sort((a, b) => a - b)
      let lane = ends.findIndex((end) => end < from)
      if (lane < 0) lane = ends.length
      ends[lane] = to.at(-1)!
      return { from, to, lane }
    })
}

export function railPath(from: Point, to: Point, laneX: number): string {
  return `M ${from.x} ${from.y} H ${laneX} V ${to.y} H ${to.x}`
}
