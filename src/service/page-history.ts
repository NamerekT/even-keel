import type { FixEpisode, TaskSession } from '../chain/launches.js'
import type { EventEntry } from '../event-log/model.js'
import type { ProjectTask, SessionView } from '../state.js'
import { isOpen } from '../tracker/model.js'

/**
 * How long a finished session and the runs of a closed task stay in the page's state after they last moved (BTN-1256):
 * the rest is asked for when a person opens the task's sessions (`history/task`).
 */
export const HISTORY_SHOWN_MS = 3 * 24 * 60 * 60_000
/** How many of the event log's newest entries the state carries; the log page asks for the rest (`history/events`). */
export const EVENT_LOG_SHOWN = 200

export interface HistoryInput {
  sessions: SessionView[]
  taskSessions: Record<string, TaskSession[]>
  eventLog: EventEntry[]
  tasks: Pick<ProjectTask, 'id' | 'status'>[]
  fixes: Record<string, FixEpisode[]>
  /** The sessions the chains wait on: kept whatever their age. */
  current: string[]
}

export interface RecentHistory {
  sessions: SessionView[]
  taskSessions: Record<string, TaskSession[]>
  /** The newest run of each task whose runs are left out: the page still orders the closed tasks by it. */
  ranAt: Record<string, string>
  eventLog: EventEntry[]
}

/** What of the sessions' history and the event log the page's state carries now. */
export function recentHistory(input: HistoryInput, now: Date): RecentHistory {
  const since = new Date(now.getTime() - HISTORY_SHOWN_MS).toISOString()
  const open = new Set([
    ...input.tasks.filter((task) => isOpen(task.status)).map((task) => task.id),
    ...Object.values(input.fixes).flatMap((episodes) => episodes.filter((episode) => episode.end === null).map((episode) => episode.id)),
  ])
  const current = new Set(input.current)
  const sessions = input.sessions.filter(
    (view) => view.lamp !== 'finished' || current.has(view.sessionId) || open.has(view.task) || (view.lastActivityAt ?? view.startedAt) >= since,
  )
  const kept = new Set(sessions.map((view) => view.sessionId))
  const taskSessions: Record<string, TaskSession[]> = {}
  const ranAt: Record<string, string> = {}
  for (const [id, runs] of Object.entries(input.taskSessions)) {
    if (open.has(id) || runs.some((each) => kept.has(each.sessionId) || movedAt(each) >= since)) taskSessions[id] = runs
    else if (runs.length > 0) ranAt[id] = runs.reduce((last, each) => (each.at > last ? each.at : last), '')
  }
  return { sessions, taskSessions, ranAt, eventLog: input.eventLog.slice(-EVENT_LOG_SHOWN) }
}

function movedAt(run: TaskSession): string {
  return [run.at, run.answeredAt, run.left?.at, run.replaced?.at].reduce<string>((last, at) => (at !== undefined && at > last ? at : last), '')
}
