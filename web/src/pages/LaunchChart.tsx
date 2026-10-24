import { useState } from 'react'
import { Link } from 'react-router'
import type { LaunchDay } from '../../../src/chain/launches.js'
import { localized, t } from '../i18n/index.js'
import { projectPath } from '../state.js'
import { Card } from '../ui/blocks.js'
import { ProjectLabel, useProjectLabel } from '../ui/ProjectLabel.js'
import { seriesStyle } from '../ui/series.js'

const DAY = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', weekday: 'short' }))
const MONTH = localized((language) => new Intl.DateTimeFormat(language, { month: 'short' }))

export function localDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year!, month! - 1, date)
}

function dayTotal(day: LaunchDay): number {
  return Object.values(day.counts).reduce((sum, count) => sum + count, 0)
}

/** `slots` — the projects of the config in its order, each with its slot (`projectSlots`). */
export function LaunchChart({ days, slots }: { days: LaunchDay[]; slots: Record<string, number | null> }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const label = useProjectLabel()
  const shown = [...new Set([...Object.keys(slots), ...days.flatMap((day) => Object.keys(day.counts))])]
  const style = (project: string) => seriesStyle(slots[project] ?? null)
  const totals = new Map(shown.map((project) => [project, days.reduce((sum, day) => sum + (day.counts[project] ?? 0), 0)]))
  const total = days.reduce((sum, day) => sum + dayTotal(day), 0)
  const max = Math.max(0, ...days.map(dayTotal))

  return (
    <Card
      className="chart"
      title={t.launches.title(days.length)}
      titleId="launch-chart-title"
      actions={<span className="chart__total">{t.launches.count(total)}</span>}
    >

      {shown.length > 1 && (
        <ul className="chart__legend chart__legend--projects">
          {shown.map((project) => (
            <li key={project} className="chart__key" style={style(project)}>
              <span className="chart__swatch" aria-hidden="true" />
              {Object.hasOwn(slots, project) ? (
                <Link to={projectPath(project)} className="chart__key-link">
                  <ProjectLabel project={project} />
                </Link>
              ) : (
                <ProjectLabel project={project} />
              )}
              <span className="chart__key-count">{totals.get(project)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="chart__plot" onMouseLeave={() => setHovered(null)}>
        <div className="chart__axis" aria-hidden="true">
          <span>{max > 0 && max}</span>
          <span>0</span>
        </div>
        <div className="chart__columns">
          {total === 0 && <p className="chart__empty">{t.launches.none}</p>}
          {days.map((day, index) => {
            const date = localDate(day.day)
            const sum = dayTotal(day)
            const stack = shown.filter((project) => (day.counts[project] ?? 0) > 0)
            return (
              <div
                key={day.day}
                className="chart__column"
                tabIndex={0}
                aria-label={`${DAY().format(date)}: ${t.launches.count(sum)}`}
                onMouseEnter={() => setHovered(index)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                onClick={() => setHovered(index)}
              >
                <div className="chart__track">
                  <div className="chart__stack" style={{ height: max === 0 ? 0 : `${(sum / max) * 100}%` }}>
                    {stack.map((project) => (
                      <span key={project} className="chart__segment" style={{ ...style(project), flexGrow: day.counts[project] }} />
                    ))}
                  </div>
                </div>
                <span className="chart__day">
                  {date.getDate()}
                  {(index === 0 || date.getDate() === 1) && (
                    <span className="chart__month">{MONTH().format(date).replace('.', '')}</span>
                  )}
                </span>
                {hovered === index && (
                  <div className={`chart__tip chart__tip--${index < days.length / 2 ? 'right' : 'left'}`} role="tooltip">
                    <strong>{DAY().format(date)}</strong>
                    {stack.length === 0 ? (
                      <span className="chart__tip-row">{t.launches.noneOnDay}</span>
                    ) : (
                      [...stack].reverse().map((project) => (
                        <span key={project} className="chart__tip-row" style={style(project)}>
                          <span className="chart__swatch" aria-hidden="true" />
                          {label(project)}
                          <span className="chart__tip-count">{day.counts[project]}</span>
                        </span>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <details className="chart__table">
        <summary>{t.launches.table}</summary>
        <div className="chart__table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{t.launches.day}</th>
                {shown.map((project) => (
                  <th key={project} scope="col">
                    {label(project)}
                  </th>
                ))}
                <th scope="col">{t.common.total}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.day}>
                  <th scope="row">{DAY().format(localDate(day.day))}</th>
                  {shown.map((project) => (
                    <td key={project}>{day.counts[project] ?? 0}</td>
                  ))}
                  <td>{dayTotal(day)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  )
}
