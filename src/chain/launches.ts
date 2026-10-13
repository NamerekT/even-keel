import type { SessionView } from '../state.js'
import type { LaunchEntry, ReleaseReason } from './dispatcher.js'
import { isFixName } from './fix.js'

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
    if (isRelease(entry)) continue
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
  how: 'launch' | 'relay' | HandOver | 'manual'
  resumed: number
  left?: { at: string; reason: ReleaseReason; blockers: string[] }
  replaced?: { at: string; how: HandOver }
  /** The e-mail of the account the session ran on; `null` when it is not known. */
  account?: string | null
}

type HandOver = 'restart' | 'checkpoint'

export function taskSessions(
  entries: LaunchEntry[],
  live: Pick<SessionView, 'task' | 'sessionId' | 'startedAt'>[],
  accountOf?: (sessionId: string, at: string) => string | null,
): Record<string, TaskSession[]> {
  const byTask = new Map<string, Map<string, TaskSession>>()
  const rowsOf = (task: string) => {
    let rows = byTask.get(task)
    if (rows === undefined) byTask.set(task, (rows = new Map()))
    return rows
  }
  const releases: (LaunchEntry & { reason: ReleaseReason })[] = []
  for (const entry of entries) {
    if (isRelease(entry)) {
      releases.push(entry)
      continue
    }
    const rows = rowsOf(entry.task)
    const known = rows.get(entry.sessionId)
    if (known !== undefined) {
      if (entry.reason === 'resume' || entry.reason === 'answer') known.resumed++
      continue
    }
    const how = entry.reason === 'relay' || entry.reason === 'restart' || entry.reason === 'checkpoint' ? entry.reason : 'launch'
    rows.set(entry.sessionId, { sessionId: entry.sessionId, at: entry.at, how, resumed: 0 })
    if ((how === 'restart' || how === 'checkpoint') && entry.previous !== undefined) {
      const old = rows.get(entry.previous)
      if (old !== undefined) old.replaced = { at: entry.at, how }
    }
  }
  for (const view of live) {
    const rows = rowsOf(view.task)
    if (!rows.has(view.sessionId)) rows.set(view.sessionId, { sessionId: view.sessionId, at: view.startedAt, how: 'manual', resumed: 0 })
  }
  for (const entry of releases) {
    const row = byTask.get(entry.task)?.get(entry.sessionId)
    if (row !== undefined) row.left = { at: entry.at, reason: entry.reason, blockers: entry.blockers ?? [] }
  }
  const result: Record<string, TaskSession[]> = {}
  for (const [task, rows] of byTask) {
    if (accountOf !== undefined) for (const row of rows.values()) row.account = accountOf(row.sessionId, row.at)
    result[task] = [...rows.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  }
  return result
}

export interface TaskRun {
  project: string
  task: string
  /** Sessions of the task started from a handoff, up to and including this one. */
  handoffs: number
}

/** The task of a session the chain started and how many handoffs it had had by then; `undefined` for any other session. */
export function handoffsOf(entries: LaunchEntry[], sessionId: string): TaskRun | undefined {
  const own = entries.find((entry) => entry.sessionId === sessionId && !isRelease(entry))
  if (own === undefined) return undefined
  const seen = new Set<string>()
  let handoffs = 0
  for (const entry of entries) {
    if (entry.task !== own.task || isRelease(entry) || seen.has(entry.sessionId)) continue
    seen.add(entry.sessionId)
    if (entry.reason === 'relay' || entry.reason === 'restart' || entry.reason === 'checkpoint') handoffs++
    if (entry === own) break
  }
  return { project: own.project, task: own.task, handoffs }
}

/** The tasks of a project the chain started a session on since `since`, each once, in launch order; fix sessions of main are not tasks. */
export function ranSince(entries: LaunchEntry[], project: string, since: Date): string[] {
  const ran = new Set<string>()
  for (const entry of entries) {
    if (entry.project !== project || isRelease(entry) || isFixName(entry.task) || !(Date.parse(entry.at) >= since.getTime())) continue
    ran.add(entry.task)
  }
  return [...ran]
}

/** The projects the chain has started a task of, each once: their tracker is fixed until a switch can keep the tasks apart (BTN-66). */
export function launchedProjects(entries: LaunchEntry[]): string[] {
  return [...new Set(entries.filter((entry) => !isRelease(entry) && !isFixName(entry.task)).map((entry) => entry.project))]
}

function isRelease(entry: LaunchEntry): entry is LaunchEntry & { reason: ReleaseReason } {
  return entry.reason === 'postpone' || entry.reason === 'skip'
}

function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
