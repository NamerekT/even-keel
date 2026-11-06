import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { EventEntry } from '../../../src/event-log/model.js'
import type { EvenKeelState } from '../../../src/state.js'
import { formatFullTime, formatLineTime, minuteMarks } from '../format.js'
import { localized, t } from '../i18n/index.js'
import { lastId, markRead, placePath, readMark } from '../layout/eventLog.js'
import { useNow } from '../layout/useNow.js'
import { Card, EmptyState, PageHead } from '../ui/blocks.js'
import { Said } from '../ui/ProjectLinks.js'
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

/**
 * `/log` (BTN-350): what the service's event log wrote, a card per day, newest first. Opening it marks the warnings
 * and errors read; the ones unread at the opening keep a "new" mark while the page stays.
 */
export function EventLogPage({ state }: { state: EvenKeelState }) {
  const now = useNow(CLOCK_MS)
  const [read] = useState(() => readMark() ?? lastId(state.eventLog))
  const newest = lastId(state.eventLog)
  useEffect(() => markRead(newest), [newest])
  const days = daysOf(state.eventLog)
  const today = now.toDateString()

  return (
    <div className="page event-log">
      <PageHead title={t.events.title} help={<HelpTip text={t.events.help} />} />
      {days.length === 0 ? (
        <Card>
          <EmptyState action={<Link to="/" className="button button--primary">{t.events.emptyAction}</Link>}>{t.events.empty}</EmptyState>
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
        return (
          <li key={entry.id} className={`event-log__row event-log__row--${entry.level}`}>
            <Tipped tip={formatFullTime(entry.at)} inline className="event-log__time">
              {marks[index] ? formatLineTime(entry.at) : ''}
            </Tipped>
            <Tipped tip={t.events.levels[entry.level]} inline className="event-log__level">
              <span className="event-log__dot" role="img" aria-label={t.events.levels[entry.level]} />
            </Tipped>
            <span className="event-log__text">
              <Said notice={entry.notice} />
              {fresh && <span className="chip event-log__fresh">{t.events.fresh}</span>}
            </span>
            {path !== null && (
              <Link to={path} className="button button--small event-log__open">
                {t.events.open}
              </Link>
            )}
          </li>
        )
      })}
    </ol>
  )
}
