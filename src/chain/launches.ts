import type { LaunchEntry } from './dispatcher.js'

export interface LaunchDay {
  day: string
  counts: Record<string, number>
}

export function launchDays(entries: LaunchEntry[], now: Date, days: number): LaunchDay[] {
  const result: LaunchDay[] = []
  for (let back = days - 1; back >= 0; back--) {
    result.push({ day: localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)), counts: {} })
  }
  const byDay = new Map(result.map((entry) => [entry.day, entry.counts]))
  for (const entry of entries) {
    const at = new Date(entry.at)
    if (Number.isNaN(at.getTime())) continue
    const counts = byDay.get(localDay(at))
    if (counts !== undefined) counts[entry.project] = (counts[entry.project] ?? 0) + 1
  }
  return result
}

function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
