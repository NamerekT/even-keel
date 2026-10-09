import { useState } from 'react'
import { useSearchParams } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import type { ToolsView } from '../../../src/tools/model.js'
import { t } from '../i18n/index.js'
import { ProjectList } from '../ui/ProjectList.js'
import { LastSessions } from './LastSessions.js'
import { hiddenSkills, problemCount, problemsOf } from './matrix.js'
import { Problems } from './Problems.js'
import { SettingsMatrix } from './SettingsMatrix.js'
import { useToolsViews } from './useToolsViews.js'
import './tools.css'

/** Without `projects` in the address only the first projects are compared: every column narrows the table. */
const FIRST_PROJECTS = 2

export function ToolsPage({ state }: { state: EvenKeelState }) {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const listed = params.get('projects')
  const selected = listed === null ? state.projects.slice(0, FIRST_PROJECTS) : listed.split(',').filter((each) => state.projects.includes(each))
  const onlyDiff = params.get('diff') === '1'
  const loaded = useToolsViews(state.projects, state.trimTools)

  const chosen = selected
  const views: ToolsView[] = []
  const failures: string[] = []
  let loading = false
  for (const project of chosen) {
    const each = loaded.get(project)
    if (each === undefined || each.state === 'loading') loading = true
    else if (each.state === 'failed') failures.push(`${project} — ${t.tools.failed}: ${each.error}`)
    else if (each.view !== null) views.push(each.view)
  }

  const items = state.projects.map((project) => {
    const each = loaded.get(project)
    const count = each?.state === 'ready' && each.view !== null ? problemCount(problemsOf(each.view)) : null
    return { project, amount: count ?? 0, label: t.tools.pickerCount(count) }
  })

  const update = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    change(next)
    setParams(next)
  }
  const choose = (projects: string[] | null) => update((next) => next.set('projects', (projects ?? state.projects).join(',')))
  const setOnlyDiff = (on: boolean) => update((next) => (on ? next.set('diff', '1') : next.delete('diff')))

  return (
    <div className="page tools-page">
      <header>
        <h1 className="page__title">{t.tools.heading}</h1>
        <p className="tools__muted">{t.tools.hint}</p>
      </header>
      {views.length > 0 && (
        <p className={views[0]!.trim ? 'tools__trim' : 'tools__trim tools__trim--off'}>{views[0]!.trim ? t.tools.trimOn(hiddenSkills(views)) : t.tools.trimOff}</p>
      )}
      <div className="tools-page__body">
        <ProjectList items={items} empty={t.tools.noProjects} selected={selected} onChange={choose} />
        <div className="tools-page__main" aria-busy={loading}>
          {failures.map((failure) => (
            <p key={failure} className="notice notice--error">
              {failure}
            </p>
          ))}
          {chosen.length === 0 ? (
            <p className="placeholder">{t.tools.noneChosen}</p>
          ) : views.length === 0 ? (
            loading && <p className="placeholder">{t.tools.loading}</p>
          ) : (
            <>
              <Problems views={views} accounts={views[0]!.accounts} />
              <div className="tools__toolbar">
                <input
                  type="search"
                  className="tools__find"
                  placeholder={t.tools.find}
                  aria-label={t.tools.find}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {views.length > 1 && (
                  <label className="tools__toggle">
                    <input type="checkbox" checked={onlyDiff} onChange={(event) => setOnlyDiff(event.target.checked)} />
                    {t.tools.onlyDiff}
                  </label>
                )}
              </div>
              <SettingsMatrix views={views} query={query} onlyDiff={onlyDiff && views.length > 1} />
              <LastSessions views={views} />
              {views[0]!.accounts.length === 0 && <p className="tools__muted">{t.tools.accountsSame}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
