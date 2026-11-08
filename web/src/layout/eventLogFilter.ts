import type { EventEntry, EventLevel } from '../../../src/event-log/model.js'
import type { Notice, NoticeCode } from '../../../src/notice/notice.js'

export const EVENT_CATEGORIES = ['sessions', 'chain', 'questions', 'main', 'limits', 'packages', 'settings', 'system'] as const
export type EventCategory = (typeof EVENT_CATEGORIES)[number]

const categories = {
  'eventLog.launch': 'sessions',
  'eventLog.continued': 'sessions',
  'eventLog.handoff': 'sessions',
  'eventLog.reviewOpened': 'sessions',
  'eventLog.stopped': 'sessions',
  'eventLog.fixLaunch': 'sessions',
  'eventLog.fixStopped': 'sessions',
  'eventLog.carryLaunch': 'sessions',
  'eventLog.carryStopped': 'sessions',
  'eventLog.uncommitted': 'sessions',
  'eventLog.unmerged': 'sessions',
  'eventLog.chainStarted': 'chain',
  'eventLog.chainStopped': 'chain',
  'eventLog.chainPaused': 'chain',
  'eventLog.chainResumed': 'chain',
  'eventLog.chainHeld': 'chain',
  'eventLog.conflict': 'chain',
  'eventLog.ask': 'questions',
  'eventLog.red': 'main',
  'eventLog.ciRed': 'main',
  'eventLog.ciRerun': 'main',
  'eventLog.ciRerunGreen': 'main',
  'eventLog.ciRerunRed': 'main',
  'eventLog.ciRerunFailed': 'main',
  'eventLog.limit': 'limits',
  'eventLog.usageUnread': 'limits',
  'eventLog.usageOff': 'limits',
  'eventLog.packages': 'packages',
  'eventLog.settings': 'settings',
  'eventLog.projectSettings': 'settings',
  'eventLog.projectAdded': 'settings',
  'eventLog.projectRemoved': 'settings',
} satisfies Record<Extract<NoticeCode, `eventLog.${string}`>, EventCategory>

export function categoryOf(notice: Notice): EventCategory {
  return Object.hasOwn(categories, notice.code) ? categories[notice.code as keyof typeof categories] : 'system'
}

export function projectOf(entry: EventEntry): string | null {
  if (entry.place !== null && 'project' in entry.place && entry.place.project !== null) return entry.place.project
  const params = entry.notice.params
  return 'project' in params && typeof params.project === 'string' ? params.project : null
}

/**
 * What an `eventLog.*` entry is about, shown in a column of its own: its texts leave it out (BTN-852). A task keeps the
 * project of its place for the link; a removed project is only its key. Other messages name what they are about inline.
 */
export type EventSubject = { task: string; project: string | null } | { project: string } | { key: string }

export function subjectOf(entry: EventEntry): EventSubject | null {
  if (!entry.notice.code.startsWith('eventLog.')) return null
  const params = entry.notice.params as { task?: unknown; key?: unknown }
  if (typeof params.task === 'string') return { task: params.task, project: projectOf(entry) }
  const project = projectOf(entry)
  if (project !== null) return { project }
  return typeof params.key === 'string' ? { key: params.key } : null
}

/** The lowest level shown: `warning` shows warnings and errors. Info alone is not a filter, all levels are. */
export type EventThreshold = Exclude<EventLevel, 'info'>
export const EVENT_THRESHOLDS = ['warning', 'error'] as const satisfies readonly EventThreshold[]
const RANK: Record<EventLevel, number> = { info: 0, warning: 1, error: 2 }

export type EventFilter = { level: EventThreshold | null; category: EventCategory | null; project: string | null }

export function filterOf(search: URLSearchParams): EventFilter {
  const level = search.get('level')
  const category = search.get('category')
  return {
    level: EVENT_THRESHOLDS.find((each) => each === level) ?? null,
    category: EVENT_CATEGORIES.find((each) => each === category) ?? null,
    project: search.get('project') || null,
  }
}

export function searchOf(filter: EventFilter): URLSearchParams {
  const search = new URLSearchParams()
  for (const field of ['level', 'category', 'project'] as const) {
    if (filter[field] !== null) search.set(field, filter[field])
  }
  return search
}

export function filtered(entries: readonly EventEntry[], filter: EventFilter): EventEntry[] {
  return entries.filter((entry) =>
    (filter.level === null || RANK[entry.level] >= RANK[filter.level]) &&
    (filter.category === null || categoryOf(entry.notice) === filter.category) &&
    (filter.project === null || projectOf(entry) === filter.project),
  )
}
