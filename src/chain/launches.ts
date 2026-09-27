import type { SessionView } from '../state.js'
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

export interface TaskSession {
  sessionId: string
  at: string
  how: 'launch' | 'relay' | 'manual'
  resumed: number
}

export function taskSessions(
  entries: LaunchEntry[],
  live: Pick<SessionView, 'task' | 'sessionId' | 'startedAt'>[],
): Record<string, TaskSession[]> {
  const byTask = new Map<string, Map<string, TaskSession>>()
  const rowsOf = (task: string) => {
    let rows = byTask.get(task)
    if (rows === undefined) byTask.set(task, (rows = new Map()))
    return rows
  }
  for (const entry of entries) {
    const rows = rowsOf(entry.task)
    const known = rows.get(entry.sessionId)
    if (known !== undefined) {
      if (entry.reason === 'resume') known.resumed++
      continue
    }
    rows.set(entry.sessionId, { sessionId: entry.sessionId, at: entry.at, how: entry.reason === 'relay' ? 'relay' : 'launch', resumed: 0 })
  }
  for (const view of live) {
    const rows = rowsOf(view.task)
    if (!rows.has(view.sessionId)) rows.set(view.sessionId, { sessionId: view.sessionId, at: view.startedAt, how: 'manual', resumed: 0 })
  }
  const result: Record<string, TaskSession[]> = {}
  for (const [task, rows] of byTask) result[task] = [...rows.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return result
}

function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
