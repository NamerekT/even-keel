import { useState } from 'react'
import { formatUsd } from './format.js'
import { heatLevel } from './history.js'
import { MONTHS, MONTHS_SHORT, addDays, addMonths, formatDay, monthEnd, type DayRange } from './period.js'

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

type Mode = { kind: 'days'; month: string } | { kind: 'months'; year: number } | { kind: 'years' }

function sorted(a: string, b: string): DayRange {
  return a <= b ? { from: a, to: b } : { from: b, to: a }
}

function monthOf(day: string): string {
  return `${day.slice(0, 7)}-01`
}

export function Calendar({
  range,
  today,
  firstDay,
  heat,
  onPick,
}: {
  range: DayRange
  today: string
  firstDay: string | null
  heat: Map<string, number>
  onPick: (range: DayRange) => void
}) {
  const latest = addMonths(monthOf(today), -1)
  const [mode, setMode] = useState<Mode>({ kind: 'days', month: [addMonths(monthOf(range.to), -1), latest].sort()[0]! })
  const [anchor, setAnchor] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const shown = anchor === null ? range : sorted(anchor, hover ?? anchor)
  const dayMax = Math.max(0, ...heat.values())

  const pick = (day: string) => {
    if (anchor === null) return setAnchor(day)
    setAnchor(null)
    onPick(sorted(anchor, day))
  }

  if (mode.kind === 'years') {
    const first = Number((firstDay ?? today).slice(0, 4))
    const last = Number(today.slice(0, 4))
    const years = Array.from({ length: last - first + 1 }, (_, index) => first + index)
    const costs = years.map((year) => sumWhere(heat, (day) => day.startsWith(`${year}-`)))
    const max = Math.max(0, ...costs)
    return (
      <div className="calendar">
        <div className="calendar__head">
          <span className="calendar__title calendar__title--static">Годы</span>
        </div>
        <div className="calendar__grid calendar__grid--wide">
          {years.map((year, index) => (
            <button
              key={year}
              type="button"
              className={`calendar__cell calendar__cell--wide heat-${heatLevel(costs[index]!, max)}`}
              title={formatUsd(costs[index]!)}
              onClick={() => setMode({ kind: 'months', year })}
            >
              {year}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (mode.kind === 'months') {
    const costs = MONTHS_SHORT.map((_, index) => sumWhere(heat, (day) => day.startsWith(`${mode.year}-${String(index + 1).padStart(2, '0')}-`)))
    const max = Math.max(0, ...costs)
    return (
      <div className="calendar">
        <div className="calendar__head">
          <button type="button" className="calendar__nav" aria-label="Предыдущий год" onClick={() => setMode({ kind: 'months', year: mode.year - 1 })}>
            ‹
          </button>
          <button type="button" className="calendar__title" onClick={() => setMode({ kind: 'years' })}>
            {mode.year}
          </button>
          <button
            type="button"
            className="calendar__nav"
            aria-label="Следующий год"
            disabled={mode.year >= Number(today.slice(0, 4))}
            onClick={() => setMode({ kind: 'months', year: mode.year + 1 })}
          >
            ›
          </button>
        </div>
        <div className="calendar__grid calendar__grid--wide">
          {MONTHS_SHORT.map((name, index) => {
            const month = `${mode.year}-${String(index + 1).padStart(2, '0')}-01`
            return (
              <button
                key={name}
                type="button"
                className={`calendar__cell calendar__cell--wide heat-${heatLevel(costs[index]!, max)}`}
                disabled={month > today}
                title={formatUsd(costs[index]!)}
                onClick={() => setMode({ kind: 'days', month: month > latest ? latest : month })}
              >
                {name}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const months = [mode.month, addMonths(mode.month, 1)]
  return (
    <div className="calendar calendar--days" onMouseLeave={() => setHover(null)}>
      {months.map((month, index) => (
        <div key={month} className="calendar__month">
          <div className="calendar__head">
            {index === 0 ? (
              <button type="button" className="calendar__nav" aria-label="Предыдущий месяц" onClick={() => setMode({ kind: 'days', month: addMonths(mode.month, -1) })}>
                ‹
              </button>
            ) : (
              <span className="calendar__nav-gap" />
            )}
            <button type="button" className="calendar__title" onClick={() => setMode({ kind: 'months', year: Number(month.slice(0, 4)) })}>
              {MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
            </button>
            {index === 1 ? (
              <button
                type="button"
                className="calendar__nav"
                aria-label="Следующий месяц"
                disabled={mode.month >= latest}
                onClick={() => setMode({ kind: 'days', month: addMonths(mode.month, 1) })}
              >
                ›
              </button>
            ) : (
              <span className="calendar__nav-gap" />
            )}
          </div>
          <div className="calendar__grid">
            {WEEKDAYS.map((name) => (
              <span key={name} className="calendar__weekday">
                {name}
              </span>
            ))}
            {monthDays(month).map((day, cell) => {
              if (day === null) return <span key={`gap-${cell}`} />
              const cost = heat.get(day) ?? 0
              const classes = ['calendar__cell', `heat-${heatLevel(cost, dayMax)}`]
              if (day >= shown.from && day <= shown.to) classes.push('calendar__cell--in')
              if (day === shown.from) classes.push('calendar__cell--from')
              if (day === shown.to) classes.push('calendar__cell--to')
              if (day === today) classes.push('calendar__cell--today')
              return (
                <button
                  key={day}
                  type="button"
                  className={classes.join(' ')}
                  disabled={day > today}
                  title={`${formatDay(day)}: ${formatUsd(cost)}`}
                  onMouseEnter={() => setHover(day)}
                  onFocus={() => setHover(day)}
                  onClick={() => pick(day)}
                >
                  {Number(day.slice(8))}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <p className="calendar__hint">{anchor === null ? 'Первый клик — начало, второй — конец.' : `С ${formatDay(anchor)} — выберите конец.`}</p>
    </div>
  )
}

function monthDays(month: string): (string | null)[] {
  const weekday = (new Date(`${month}T00:00:00Z`).getUTCDay() + 6) % 7
  const days: (string | null)[] = Array.from({ length: weekday }, () => null)
  for (let day = month; day <= monthEnd(month); day = addDays(day, 1)) days.push(day)
  return days
}

function sumWhere(heat: Map<string, number>, test: (day: string) => boolean): number {
  let sum = 0
  for (const [day, cost] of heat) if (test(day)) sum += cost
  return sum
}
