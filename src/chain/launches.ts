import type { SessionView } from '../state.js'
import type { LaunchEntry, ReleaseReason } from './dispatcher.js'
import { fixEpisodeId, fixName, fixTaskOf, isFixName, liveFixId } from './fix.js'
import type { FixOutcome, RelayCause } from './model.js'

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
    if (!isLaunch(entry)) continue
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
  /** Why a `relay` session started; absent in an older journal, which only knew the limit. */
  cause?: RelayCause
  resumed: number
  /** The user's answers that resumed it. */
  answers: number
  /** When the service began delivering the last of them. */
  answeredAt?: string
  left?: { at: string; reason: ReleaseReason; blockers: string[] }
  replaced?: { at: string; how: HandOver | 'relay'; cause?: RelayCause }
  /** The e-mail of the account the session ran on; `null` when it is not known. */
  account?: string | null
}

type HandOver = 'restart' | 'checkpoint'

/** A fix of a red main from its first launch to its outcome (BTN-153). */
export interface FixEpisode {
  /** `ABC-FIX.<n>`, the row of the episode on the page. */
  id: string
  /** The red commit the fix was started for; `null` in a log from before the commit was kept. */
  red: string | null
  at: string
  /** `null` while the fix is not over. */
  end: FixEnd | null
}

export interface FixEnd {
  at: string
  /** `lost` — another fix started without a word of how this one ended. */
  how: FixOutcome | 'lost'
  /** The commit main went out at when the fix landed. */
  commit: string | null
}

/**
 * The fixes of each project's red main in the launch log, oldest first, and the episode of each fix entry. An episode
 * is a launch with its handovers, resumes and answers up to its outcome; a launch for the same red commit is part of it.
 */
export function fixEpisodes(entries: LaunchEntry[]): { episodes: Record<string, FixEpisode[]>; of: Map<LaunchEntry, string> } {
  const episodes: Record<string, FixEpisode[]> = {}
  const of = new Map<LaunchEntry, string>()
  for (const entry of entries) {
    if (!isFixName(entry.task)) continue
    const list = (episodes[entry.project] ??= [])
    let open = list.at(-1)
    if (open?.end !== null) open = undefined
    const start = () => {
      const episode: FixEpisode = { id: fixEpisodeId(entry.project, list.length + 1), red: entry.commit ?? null, at: entry.at, end: null }
      list.push(episode)
      return episode
    }
    if (isOutcome(entry)) {
      if (open === undefined) continue
      open.end = { at: entry.at, how: entry.reason, commit: entry.commit ?? null }
      of.set(entry, open.id)
      continue
    }
    if (entry.reason === undefined && (open === undefined || open.red === null || open.red !== entry.commit)) {
      if (open !== undefined) open.end = { at: entry.at, how: 'lost', commit: null }
      open = start()
    }
    of.set(entry, (open ?? start()).id)
  }
  return { episodes, of }
}

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
  const fixes = fixEpisodes(entries)
  const rowOf = (entry: LaunchEntry) => fixes.of.get(entry) ?? entry.task
  const releases: (LaunchEntry & { reason: ReleaseReason })[] = []
  for (const entry of entries) {
    if (isRelease(entry)) {
      releases.push(entry)
      continue
    }
    if (isOutcome(entry)) continue
    const rows = rowsOf(rowOf(entry))
    const known = rows.get(entry.sessionId)
    if (known !== undefined) {
      if (entry.reason === 'resume') known.resumed++
      if (entry.reason === 'answer') {
        known.answers++
        known.answeredAt = entry.at
      }
      continue
    }
    const relayed = entry.reason === 'relay' || (entry.reason === 'review' && entry.cause !== undefined)
    const how = relayed ? 'relay' : entry.reason === 'restart' || entry.reason === 'checkpoint' ? entry.reason : 'launch'
    const cause = relayed ? entry.cause : undefined
    rows.set(entry.sessionId, { sessionId: entry.sessionId, at: entry.at, how, ...(cause === undefined ? {} : { cause }), resumed: 0, answers: 0 })
    if ((how === 'restart' || how === 'checkpoint' || how === 'relay') && entry.previous !== undefined) {
      const old = rows.get(entry.previous)
      if (old !== undefined) old.replaced = { at: entry.at, how, ...(cause === undefined ? {} : { cause }) }
    }
  }
  for (const view of live) {
    const fix = isFixName(view.task) ? fixTaskOf(view.task) : null
    const project = fix === null ? '' : fix.slice(0, -fixName('').length)
    const rows = rowsOf(fix === null ? view.task : liveFixId(project, fixes.episodes[project] ?? []))
    if (!rows.has(view.sessionId)) rows.set(view.sessionId, { sessionId: view.sessionId, at: view.startedAt, how: 'manual', resumed: 0, answers: 0 })
  }
  for (const entry of releases) {
    const row = byTask.get(rowOf(entry))?.get(entry.sessionId)
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
  const own = entries.find((entry) => entry.sessionId === sessionId && isLaunch(entry))
  if (own === undefined) return undefined
  const seen = new Set<string>()
  let handoffs = 0
  for (const entry of entries) {
    if (entry.task !== own.task || !isLaunch(entry) || seen.has(entry.sessionId)) continue
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

/** The launches since `since` whose run label named a provider without an account in the pool, newest first: the page's toast. */
export function fallbacksSince(entries: LaunchEntry[], since: Date): (LaunchEntry & { fallback: string })[] {
  return entries
    .filter((entry): entry is LaunchEntry & { fallback: string } => entry.fallback !== undefined && Date.parse(entry.at) >= since.getTime())
    .reverse()
}

/** An entry of a session the chain started or continued: not a release, not the outcome of a fix. */
export function isLaunch(entry: LaunchEntry): boolean {
  return !isRelease(entry) && !isOutcome(entry)
}

function isRelease(entry: LaunchEntry): entry is LaunchEntry & { reason: ReleaseReason } {
  return entry.reason === 'postpone' || entry.reason === 'skip'
}

function isOutcome(entry: LaunchEntry): entry is LaunchEntry & { reason: FixOutcome } {
  return entry.reason === 'landed' || entry.reason === 'dropped'
}

function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
