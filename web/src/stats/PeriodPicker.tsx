import { useEffect, useState, type FormEvent } from 'react'
import { usePopover } from '../layout/usePopover.js'
import { Calendar } from './Calendar.js'
import { PRESETS, formatRange, shiftRange, type DayRange, type PeriodChoice } from './period.js'

export function PeriodPicker({
  choice,
  range,
  today,
  firstDay,
  heat,
  onChange,
}: {
  choice: PeriodChoice
  range: DayRange
  today: string
  firstDay: string | null
  heat: Map<string, number>
  onChange: (choice: PeriodChoice) => void
}) {
  const { open, setOpen, rootRef } = usePopover()
  const [from, setFrom] = useState(range.from)
  const [to, setTo] = useState(range.to)

  useEffect(() => {
    setFrom(range.from)
    setTo(range.to)
  }, [range.from, range.to, open])

  const apply = (next: PeriodChoice) => {
    onChange(next)
    setOpen(false)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (from === '' || to === '') return
    const ends = [from, to > today ? today : to].sort()
    apply({ from: ends[0]!, to: ends[1]! })
  }

  return (
    <div className="period" ref={rootRef}>
      <button type="button" className="period__shift" aria-label="Предыдущий период" onClick={() => onChange(shiftRange(range, -1, today))}>
        ‹
      </button>
      <button type="button" className="period__button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        {formatRange(range)} <span aria-hidden="true">▾</span>
      </button>
      <button
        type="button"
        className="period__shift"
        aria-label="Следующий период"
        disabled={range.to >= today}
        onClick={() => onChange(shiftRange(range, 1, today))}
      >
        ›
      </button>
      {open && (
        <div className="period__panel" role="dialog" aria-label="Период">
          <ul className="period__presets">
            {PRESETS.map(({ preset, label }) => (
              <li key={preset}>
                <button
                  type="button"
                  className={'preset' in choice && choice.preset === preset ? 'period__preset period__preset--on' : 'period__preset'}
                  onClick={() => apply({ preset })}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
          <div className="period__main">
            <Calendar range={range} today={today} firstDay={firstDay} heat={heat} onPick={apply} />
            <form className="period__inputs" onSubmit={submit}>
              <label>
                С
                <input type="date" value={from} max={today} onChange={(event) => setFrom(event.target.value)} />
              </label>
              <label>
                по
                <input type="date" value={to} max={today} onChange={(event) => setTo(event.target.value)} />
              </label>
              <button type="submit" className="button button--primary">
                Применить
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
