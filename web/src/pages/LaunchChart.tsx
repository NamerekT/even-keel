import { useState } from 'react'
import type { LaunchDay } from '../../../src/chain/launches.js'
import { localized, t } from '../i18n/index.js'
import { projectSlot } from '../state.js'
import { ProjectLabel } from '../ui/ProjectLabel.js'
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

export function LaunchChart({ days, projects }: { days: LaunchDay[]; projects: string[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const shown = [...new Set([...projects, ...days.flatMap((day) => Object.keys(day.counts))])]
  const style = (project: string) => seriesStyle(projectSlot(projects, project))
  const totals = new Map(shown.map((project) => [project, days.reduce((sum, day) => sum + (day.counts[project] ?? 0), 0)]))
  const total = days.reduce((sum, day) => sum + dayTotal(day), 0)
  const max = Math.max(0, ...days.map(dayTotal))

  return (
    <section className="chart" aria-labelledby="launch-chart-title">
      <header className="chart__head">
        <h2 id="launch-chart-title" className="chart__title">
          {t.launches.title(days.length)}
        </h2>
        <span className="chart__total">{t.launches.count(total)}</span>
      </header>

      {shown.length > 1 && (
        <ul className="chart__legend">
          {shown.map((project) => (
            <li key={project} className="chart__key" style={style(project)}>
              <span className="chart__swatch" aria-hidden="true" />
              <ProjectLabel project={project} />
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
                          {project}
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
                    {project}
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
    </section>
  )
}
