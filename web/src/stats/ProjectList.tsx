import { useState } from 'react'
import { t } from '../i18n/index.js'
import { seriesStyle } from '../ui/series.js'
import { formatUsd } from './format.js'
import type { ProjectTotal } from './history.js'

export function ProjectList({
  totals,
  colors,
  selected,
  onChange,
}: {
  totals: ProjectTotal[]
  colors: Map<string, number | null>
  selected: string[] | null
  onChange: (projects: string[] | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const chosen = (project: string) => selected === null || selected.includes(project)
  const max = Math.max(0, ...totals.map((each) => each.cost))
  const needle = query.trim().toLowerCase()
  const shown = needle === '' ? totals : totals.filter((each) => each.project.toLowerCase().includes(needle))
  const count = selected === null ? totals.length : selected.length

  const toggle = (project: string) => {
    if (selected === null) return onChange(totals.map((each) => each.project).filter((each) => each !== project))
    const next = selected.includes(project) ? selected.filter((each) => each !== project) : [...selected, project]
    onChange(totals.every((each) => next.includes(each.project)) ? null : next)
  }

  return (
    <aside className={open ? 'projects projects--open' : 'projects'} aria-label={t.stats.projects.label}>
      <button type="button" className="button projects__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t.stats.projects.count(selected === null ? t.stats.projects.all : String(count))} {open ? '▴' : '▾'}
      </button>
      <div className="projects__body">
        <input
          type="search"
          className="projects__search"
          placeholder={t.stats.projects.find}
          aria-label={t.stats.projects.findLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {totals.length === 0 ? (
          <p className="placeholder projects__empty">{t.stats.projects.empty}</p>
        ) : (
          <ul className="projects__list">
            {shown.map(({ project, cost }) => (
              <li key={project} className={chosen(project) ? 'projects__item' : 'projects__item projects__item--off'} style={seriesStyle(colors.get(project) ?? null)}>
                <input type="checkbox" checked={chosen(project)} onChange={() => toggle(project)} aria-label={t.stats.projects.include(project)} />
                <span className="chart__swatch" aria-hidden="true" />
                <button type="button" className="projects__name" title={t.stats.projects.only} onClick={() => onChange([project])}>
                  {project}
                </button>
                <span className="projects__cost">{formatUsd(cost)}</span>
                <span className="projects__bar" aria-hidden="true">
                  <span style={{ width: `${max === 0 ? 0 : (cost / max) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="projects__foot">
          <button type="button" className="link-button" onClick={() => onChange(null)} disabled={selected === null}>
            {t.stats.projects.selectAll}
          </button>
          <button type="button" className="link-button" onClick={() => onChange([])} disabled={selected !== null && selected.length === 0}>
            {t.stats.projects.reset}
          </button>
        </div>
      </div>
    </aside>
  )
}
