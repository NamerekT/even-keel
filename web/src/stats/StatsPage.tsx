import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { PeriodQuery, StatsFilter, StatsScope } from '../../../src/stats/model.js'
import type { RulesQuery } from '../../../src/stats/rules.js'
import type { EvenKeelState } from '../../../src/state.js'
import { formatMoment } from '../format.js'
import { formatUsd } from './format.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { AnswerNotice, Segmented, loadedData, useStatsAnswer } from './common.js'
import { chartData, dayCosts, firstDay, projectColors, projectTotals, type Metric } from './history.js'
import { markPlaces, pickMark } from './marks.js'
import { autoStep, localDay, resolvePeriod, type DayRange, type PeriodChoice } from './period.js'
import { PeriodPicker } from './PeriodPicker.js'
import { ProjectList } from '../ui/ProjectList.js'
import { RulesSection } from './RulesSection.js'
import { EstimateSection } from './EstimateSection.js'
import { parseView, viewSearch, type StatsView } from './search.js'
import { SpendChart } from './SpendChart.js'
import { StepsSection } from './StepsSection.js'
import { StuckSection } from './StuckSection.js'
import { Sources, Tiles } from './Summary.js'
import { TaskTable } from './TaskTable.js'
import './stats.css'

const SCOPES: StatsScope[] = ['all', 'chain']

export function StatsPage({ state }: { state: EvenKeelState }) {
  const [params, setParams] = useSearchParams()
  const view = parseView(params)
  const { statsHistory, statsPeriod, statsSteps, statsRules } = useLive()
  const [metric, setMetric] = useState<Metric>('cost')
  const [zooms, setZooms] = useState<PeriodChoice[]>([])
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const today = localDay(new Date())

  const filter: StatsFilter = { scope: view.scope, account: view.account, tz }
  const historyKey = JSON.stringify(filter)
  const historyLoaded = useStatsAnswer(historyKey, () => statsHistory(filter))
  const history = loadedData(historyLoaded)
  const range = resolvePeriod(view.period, today, history === null ? null : firstDay(history))
  const waitsHistory = 'preset' in view.period && view.period.preset === 'all' && history === null
  const query: PeriodQuery = { ...filter, ...range, projects: view.projects }
  const periodKey = waitsHistory ? null : JSON.stringify(query)
  const periodLoaded = useStatsAnswer(periodKey, () => statsPeriod(query))
  const period = loadedData(periodLoaded)
  const stepsLoaded = useStatsAnswer(periodKey, () => statsSteps(query))
  const step = view.step ?? autoStep(range)
  const [picked, setPicked] = useState<string[]>([])
  const rulesQuery: RulesQuery = { ...filter, projects: view.projects, kinds: view.kinds, purposes: view.purposes, places: view.places }
  const rulesLoaded = useStatsAnswer(JSON.stringify(rulesQuery), () => statsRules(rulesQuery))
  const rules = loadedData(rulesLoaded)
  const marks = useMemo(
    () =>
      (rules?.marks ?? [])
        .filter((mark) => {
          const day = localDay(new Date(mark.toAt))
          return day >= range.from && day <= range.to
        })
        .sort((a, b) => Date.parse(b.toAt) - Date.parse(a.toAt)),
    [rules, range.from, range.to],
  )
  const places = useMemo(() => markPlaces(marks, range, step), [marks, step])
  const pick = (key: string, extend: boolean) => setPicked(pickMark(picked, key, extend))

  const derived = useMemo(() => {
    if (history === null) return null
    return {
      colors: projectColors(history),
      totals: projectTotals(history, range),
      heat: dayCosts(history, view.projects),
      chart: chartData(history, range, step, metric, view.projects),
    }
  }, [history, range.from, range.to, step, metric, view.projects?.join(',')])

  const setView = (next: Partial<StatsView>) => setParams(viewSearch({ ...view, ...next }))
  const choose = (period: PeriodChoice) => {
    setZooms([])
    setView({ period })
  }
  const zoom = (next: DayRange) => {
    setZooms([...zooms, view.period])
    setView({ period: next, step: null })
  }
  const zoomOut = () => {
    const previous = zooms.at(-1)
    if (previous === undefined) return
    setZooms(zooms.slice(0, -1))
    setView({ period: previous, step: null })
  }

  return (
    <div className="page stats-page">
      <header className="stats-page__head">
        <h1 className="page__title">{t.stats.title}</h1>
        <PeriodPicker
          choice={view.period}
          range={range}
          today={today}
          firstDay={history === null ? null : firstDay(history)}
          heat={derived?.heat ?? new Map()}
          onChange={choose}
        />
        <div className="stats-page__filters">
          <span className="stats-page__filter">
            {t.stats.sessions}
            <Segmented
              label={t.stats.sessions}
              options={SCOPES.map((scope) => [scope, t.stats.scopes[scope]])}
              value={view.scope}
              onChange={(scope) => setView({ scope })}
            />
          </span>
          <label className="stats-page__filter">
            {t.stats.account}
            <select value={view.account ?? ''} onChange={(event) => setView({ account: event.target.value || null })}>
              <option value="">{t.stats.all}</option>
              {[...new Set([...(history?.accounts ?? []), ...(view.account === null ? [] : [view.account])])].map((account) => (
                <option key={account} value={account}>
                  {account}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {history === null || derived === null ? (
        <AnswerNotice loaded={historyLoaded} />
      ) : (
        <div className="stats-page__body">
          <ProjectList
            items={derived.totals.map(({ project, cost }) => ({ project, amount: cost, label: formatUsd(cost) }))}
            colors={derived.colors}
            empty={t.stats.projects.empty}
            selected={view.projects}
            onChange={(projects) => setView({ projects })}
          />
          <div className="stats-page__main" aria-busy={periodLoaded === null || periodLoaded.key !== periodKey}>
            {period === null ? <AnswerNotice loaded={periodLoaded} /> : <Tiles period={period} range={range} />}
            <SpendChart
              data={derived.chart}
              range={range}
              step={step}
              metric={metric}
              onStep={(next) => setView({ step: next === autoStep(range) ? null : next })}
              onMetric={setMetric}
              onZoom={zoom}
              onZoomOut={zooms.length === 0 ? null : zoomOut}
              marks={places}
              picked={picked}
              onPick={pick}
            />
            <RulesSection
              loaded={rulesLoaded}
              marks={marks}
              kinds={view.kinds}
              purposes={view.purposes}
              places={view.places}
              onFilter={setView}
              picked={picked}
              onPick={pick}
              base={{ ...filter, projects: view.projects }}
              colors={derived.colors}
              trackerUrls={state.trackerUrls}
            />
            {period !== null && (
              <>
                <Sources period={period} />
                <EstimateSection tasks={period.tasks} />
                <StepsSection loaded={stepsLoaded} />
                <TaskTable tasks={period.tasks} trackerUrls={state.trackerUrls} />
                <StuckSection weeks={period.weeks} stuck={period.stuck} trackerUrls={state.trackerUrls} />
                <p className="stats-page__foot">{t.stats.read(formatMoment(period.at, new Date()))}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
