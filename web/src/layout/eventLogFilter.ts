import type { EventEntry, EventLevel } from '../../../src/event-log/model.js'
import type { Notice, NoticeCode } from '../../../src/notice/notice.js'

export const EVENT_CATEGORIES = ['sessions', 'chain', 'questions', 'main', 'limits', 'packages', 'settings', 'system'] as const
export type EventCategory = (typeof EVENT_CATEGORIES)[number]

const categories = {
  'eventLog.launch': 'sessions',
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

export type EventFilter = { level: EventLevel | null; category: EventCategory | null; project: string | null }

export function filterOf(search: URLSearchParams): EventFilter {
  const level = search.get('level')
  const category = search.get('category')
  return {
    level: level === 'info' || level === 'warning' || level === 'error' ? level : null,
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
    (filter.level === null || entry.level === filter.level) &&
    (filter.category === null || categoryOf(entry.notice) === filter.category) &&
    (filter.project === null || projectOf(entry) === filter.project),
  )
}
