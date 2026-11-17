import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { EventEntry } from '../../../src/event-log/model.js'
import type { EvenKeelState } from '../../../src/state.js'
import { formatFullTime, formatLineTime, minuteMarks } from '../format.js'
import { localized, t } from '../i18n/index.js'
import { lastId, markRead, openPlace, placePath, readMark } from '../layout/eventLog.js'
import { EVENT_CATEGORIES, EVENT_THRESHOLDS, filtered, filterOf, projectOf, searchOf, subjectOf, type EventFilter } from '../layout/eventLogFilter.js'
import { EventSubject } from '../layout/EventSubject.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { projectLabel } from '../state.js'
import { Card, EmptyState, PageHead } from '../ui/blocks.js'
import { GoToIcon } from '../ui/icons.js'
import { Said } from '../ui/ProjectLinks.js'
import { Select } from '../ui/Select.js'
import { Tipped } from '../ui/Tipped.js'
import { HelpTip } from './settingsParts.js'
import './eventLog.css'

const DAY = localized((language) => new Intl.DateTimeFormat(language, { weekday: 'short', day: 'numeric', month: 'long' }))
const CLOCK_MS = 60_000

/** The entries of one day, newest first. */
interface Day {
  key: string
  entries: EventEntry[]
}

/** Groups the log by the local day, the newest day and entry first. */
export function daysOf(entries: readonly EventEntry[]): Day[] {
  const days: Day[] = []
  for (const entry of [...entries].reverse()) {
    const key = new Date(entry.at).toDateString()
    const last = days.at(-1)
    if (last?.key === key) last.entries.push(entry)
    else days.push({ key, entries: [entry] })
  }
  return days
}

/** The state's newest entries after the older ones of the whole log, which may be behind them or not come at all. */
export function withOlder(whole: readonly EventEntry[], recent: readonly EventEntry[]): EventEntry[] {
  const first = recent[0] === undefined ? Infinity : Number(recent[0].id)
  return [...whole.filter((entry) => Number(entry.id) < first), ...recent]
}

/** The whole log (BTN-1256): the state carries only its newest entries, the page asks for the rest once. */
function useWholeLog(recent: EventEntry[]): EventEntry[] {
  const { query } = useLive()
  const [whole, setWhole] = useState<EventEntry[]>([])
  useEffect(() => {
    let alive = true
    query<EventEntry[]>('history/events', {})
      .then((answer) => alive && setWhole(answer))
      .catch((error: unknown) => console.warn(`history/events: ${error instanceof Error ? error.message : String(error)}`))
    return () => {
      alive = false
    }
  }, [])
  return useMemo(() => withOlder(whole, recent), [whole, recent])
}

/**
 * `/log` (BTN-350): what the service's event log wrote, a card per day, newest first. Opening it marks the warnings
 * and errors read; the ones unread at the opening keep a "new" mark while the page stays.
 */
export function EventLogPage({ state }: { state: EvenKeelState }) {
  const now = useNow(CLOCK_MS)
  const [search, setSearch] = useSearchParams()
  const parsed = filterOf(search)
  const filter = { ...parsed, project: parsed.project !== null && state.projects.includes(parsed.project) ? parsed.project : null }
  const change = (next: EventFilter) => setSearch(searchOf(next), { replace: true })
  const reset = () => change({ level: null, category: null, project: null })
  const hasFilter = Object.values(filter).some((value) => value !== null)
  const log = useWholeLog(state.eventLog)
  const projects = new Set(log.map(projectOf))
  const [read] = useState(() => readMark() ?? lastId(state.eventLog))
  const newest = lastId(state.eventLog)
  useEffect(() => markRead(newest), [newest])
  const days = daysOf(filtered(log, filter))
  const today = now.toDateString()

  return (
    <div className="page event-log">
      <PageHead title={t.events.title} help={<HelpTip text={t.events.help} />} />
      {log.length > 0 && (
        <div className="event-log__filters">
          <Select className="button" label={t.events.filters.level} value={filter.level ?? ''}
            options={[{ value: '', label: t.events.filters.allLevels }, ...EVENT_THRESHOLDS.map((value) => ({ value, label: t.events.filters.thresholds[value] }))]}
            onChange={(value) => change({ ...filter, level: filterOf(new URLSearchParams({ level: value })).level })} />
          <Select className="button" label={t.events.filters.category} value={filter.category ?? ''}
            options={[{ value: '', label: t.events.filters.allCategories }, ...EVENT_CATEGORIES.map((value) => ({ value, label: t.events.categories[value] }))]}
            onChange={(value) => change({ ...filter, category: filterOf(new URLSearchParams({ category: value })).category })} />
          <Select className="button" label={t.events.filters.project} value={filter.project ?? ''}
            options={[{ value: '', label: t.events.filters.allProjects }, ...state.projects.filter((id) => projects.has(id) || id === filter.project).map((value) => ({ value, label: projectLabel(state, value) }))]}
            onChange={(value) => change({ ...filter, project: value || null })} />
          <button type="button" className="button event-log__reset" disabled={!hasFilter} onClick={reset}>{t.events.filters.reset}</button>
        </div>
      )}
      {log.length === 0 ? (
        <Card>
          <EmptyState action={<Link to="/" className="button button--primary">{t.events.emptyAction}</Link>}>{t.events.empty}</EmptyState>
        </Card>
      ) : days.length === 0 ? (
        <Card>
          <EmptyState action={<button type="button" className="button button--primary" onClick={reset}>{t.events.filters.emptyAction}</button>}>{t.events.filters.empty}</EmptyState>
        </Card>
      ) : (
        days.map((day) => (
          <Card key={day.key} title={day.key === today ? t.events.today : DAY().format(new Date(day.entries[0]!.at))}>
            <EntryList entries={day.entries} state={state} read={read} />
          </Card>
        ))
      )}
    </div>
  )
}

function EntryList({ entries, state, read }: { entries: EventEntry[]; state: EvenKeelState; read: number }) {
  const marks = minuteMarks(entries.map((entry) => entry.at))
  return (
    <ol className="event-log__list">
      {entries.map((entry, index) => {
        const path = placePath(entry.place, state)
        const fresh = entry.level !== 'info' && Number(entry.id) > read
        const subject = subjectOf(entry)
        return (
          <li key={entry.id} className={`event-log__row event-log__row--${entry.level} row-action-host`}>
            <Tipped tip={formatFullTime(entry.at)} inline className="event-log__time">
              {marks[index] ? formatLineTime(entry.at) : ''}
            </Tipped>
            <Tipped tip={t.events.levels[entry.level]} inline className="event-log__level">
              <span className="event-log__dot" role="img" aria-label={t.events.levels[entry.level]} />
            </Tipped>
            <span className="event-log__subject">{subject !== null && <EventSubject subject={subject} state={state} />}</span>
            <span className="event-log__text">
              <Said notice={entry.notice} />
              {fresh && <span className="chip event-log__fresh">{t.events.fresh}</span>}
            </span>
            {path !== null && (
              <Link to={path} onClick={() => openPlace(entry.place)} className="row-action event-log__open" aria-label={t.events.open} title={t.events.open}>
                <GoToIcon />
              </Link>
            )}
          </li>
        )
      })}
    </ol>
  )
}
