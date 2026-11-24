/**
 * The most the project's width may be (BTN-1571): the machines of its list (`ProjectPool.machines`), turned on or
 * off, at least 1 — the own machine of a project with none named. `undefined` while the pool is read.
 */
export function widthMaxOf(pool: { machines: readonly unknown[] } | null): number | undefined {
  return pool === null ? undefined : Math.max(1, pool.machines.length)
}

/** What the field keeps of a value typed: a whole number above the most becomes the most, anything else stays as typed. */
export function cappedWidth(value: string, max: number | undefined): string {
  if (max === undefined || !/^\s*\d+\s*$/.test(value)) return value
  return Number(value) > max ? String(max) : value
}
