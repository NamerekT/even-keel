import { useState, useSyncExternalStore } from 'react'
import { FoldBody, FoldToggle } from './Fold.js'
import { t } from '../i18n/index.js'
import { seriesStyle } from './series.js'
import './projects.css'

const compactQuery = '(max-width: 900px)'
const compactSnapshot = () => window.matchMedia(compactQuery).matches
const subscribeCompact = (change: () => void) => {
  const query = window.matchMedia(compactQuery)
  query.addEventListener('change', change)
  return () => query.removeEventListener('change', change)
}

export interface ProjectItem {
  project: string
  /** What the item shows, when `project` is an id. */
  name?: string
  /** Length of the bar under the name, against the largest. */
  amount: number
  label: string
}

/** `selected === null` — every project. Without `colors` the items have no swatch. */
export function ProjectList({
  items,
  colors,
  empty,
  selected,
  onChange,
}: {
  items: ProjectItem[]
  colors?: Map<string, number | null>
  empty: string
  selected: string[] | null
  onChange: (projects: string[] | null) => void
}) {
  const compact = useSyncExternalStore(subscribeCompact, compactSnapshot)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const chosen = (project: string) => selected === null || selected.includes(project)
  const max = Math.max(0, ...items.map((each) => each.amount))
  const needle = query.trim().toLowerCase()
  const shown = needle === '' ? items : items.filter((each) => (each.name ?? each.project).toLowerCase().includes(needle))
  const count = selected === null ? items.length : selected.length

  const toggle = (project: string) => {
    if (selected === null) return onChange(items.map((each) => each.project).filter((each) => each !== project))
    const next = selected.includes(project) ? selected.filter((each) => each !== project) : [...selected, project]
    onChange(items.every((each) => next.includes(each.project)) ? null : next)
  }

  return (
    <aside className={open ? 'projects projects--open' : 'projects'} aria-label={t.stats.projects.label}>
      <FoldToggle className="button projects__toggle" aria-controls="projects-filter" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t.stats.projects.count(selected === null ? t.stats.projects.all : String(count))}
      </FoldToggle>
      <FoldBody id="projects-filter" open={!compact || open}>
        <div className="projects__body">
          <input
            type="search"
            className="projects__search"
            placeholder={t.stats.projects.find}
            aria-label={t.stats.projects.findLabel}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {items.length === 0 ? (
            <p className="placeholder projects__empty">{empty}</p>
          ) : (
            <ul className="projects__list">
              {shown.map(({ project, name = project, amount, label }) => (
                <li key={project} className={chosen(project) ? 'projects__item' : 'projects__item projects__item--off'} style={seriesStyle(colors?.get(project) ?? null)}>
                  <input type="checkbox" checked={chosen(project)} onChange={() => toggle(project)} aria-label={t.stats.projects.include(name)} />
                  {colors !== undefined && <span className="chart__swatch" aria-hidden="true" />}
                  <button type="button" className="projects__name" title={t.stats.projects.only} onClick={() => onChange([project])}>
                    {name}
                  </button>
                  <span className="projects__cost">{label}</span>
                  <span className="projects__bar" aria-hidden="true">
                    <span style={{ width: `${max === 0 ? 0 : (amount / max) * 100}%` }} />
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
      </FoldBody>
    </aside>
  )
}
