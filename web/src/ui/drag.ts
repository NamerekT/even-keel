export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const result = [...list]
  const [item] = result.splice(from, 1)
  result.splice(Math.max(0, Math.min(to, result.length)), 0, item!)
  return result
}

export function dropIndex(mids: number[], center: number): number {
  let best = 0
  for (const [index, mid] of mids.entries()) {
    if (Math.abs(mid - center) < Math.abs(mids[best]! - center)) best = index
  }
  return best
}

export function dragShift(index: number, from: number, to: number, step: number): number {
  if (from < to && index > from && index <= to) return -step
  if (to < from && index >= to && index < from) return step
  return 0
}
