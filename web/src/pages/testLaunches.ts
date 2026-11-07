import type { LaunchDay } from '../../../src/chain/launches.js'

/** Only the displayed copy changes; launches of removed projects remain visible. */
export function testLaunches(days: LaunchDay[], slots: Record<string, number | null>, hidden: string[]) {
  const tests = new Set(hidden)
  const visible = <T,>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).filter(([id]) => !tests.has(id)))
  return { days: days.map(day => ({ ...day, counts: visible(day.counts) })), slots: visible(slots) }
}
