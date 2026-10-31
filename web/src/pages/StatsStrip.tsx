import { useMemo } from 'react'
import { Link } from 'react-router'
import type { PeriodQuery, StatsFilter } from '../../../src/stats/model.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { AnswerNotice, loadedData, useStatsAnswer } from '../stats/common.js'
import { formatDuration, formatShare, formatUsd, weeklyLimit } from '../stats/format.js'
import { chartData } from '../stats/history.js'
import { formatDay, formatRange, localDay, resolvePeriod } from '../stats/period.js'
import { seriesStyle } from '../ui/series.js'
import { Tipped } from '../ui/Tipped.js'
import { stripTasks, type StripTasks } from './stripTasks.js'
import '../stats/stats.css'

const DAYS = 30

export type StripData = ReturnType<typeof useStrip>

/**
 * The project's last 30 days from the stats, drawn in its `slot`; the page reads it once for the strip and the idle panel.
 * The tasks come from the same period query as `/stats?projects=<key>` behind "More →", so both share the server's cache.
 */
export function useStrip(project: string, slot: number | null) {
  const { statsHistory, statsPeriod } = useLive()
  const filter: StatsFilter = useMemo(() => ({ scope: 'all', account: null, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }), [])
  const loaded = useStatsAnswer(JSON.stringify(filter), () => statsHistory(filter))
  const history = loadedData(loaded)
  const range = resolvePeriod({ preset: '30d' }, localDay(new Date()), null)
  const query: PeriodQuery = { ...filter, ...range, projects: [project] }
  const period = loadedData(useStatsAnswer(JSON.stringify(query), () => statsPeriod(query)))
  const tasks = useMemo(() => (period === null ? null : stripTasks(period.tasks)), [period])

  const summary = useMemo(() => {
    if (history === null) return null
    const index = history.projects.indexOf(project)
    const cells = history.cells.filter(([day, at]) => at === index && history.days[day]! >= range.from && history.days[day]! <= range.to)
    const sum = (column: 2 | 3 | 4) => cells.reduce((total, cell) => total + cell[column], 0)
    return {
      cost: sum(2),
      sessions: sum(3),
      limit: weeklyLimit(cells.length === 0 ? null : sum(4), range, history.limits),
      days: chartData(history, range, 'day', 'cost', [project], new Map([[project, slot]])).buckets.map((each) => each.total),
      slot,
    }
  }, [history, project, slot, range.from])

  return { loaded, summary, range, tasks }
}

export function StatsStrip({ project, strip: { loaded, summary, range, tasks }, onCard }: { project: string; strip: StripData; onCard: (task: string) => void }) {
  return (
    <section className="strip" aria-label={t.strip.label(project, DAYS)}>
      {loaded === null ? (
        <StripSkeleton />
      ) : summary === null ? (
        <AnswerNotice loaded={loaded} />
      ) : (
        <>
          <dl className="strip__facts">
            <div>
              <dt>{t.strip.cost}</dt>
              <dd>{formatUsd(summary.cost)}</dd>
            </div>
            <div>
              <dt>{t.strip.limit}</dt>
              <dd title={summary.limit.share === null ? t.strip.noSnapshots : undefined}>
                {summary.limit.share === null ? '—' : `${summary.limit.perWeek ? '≈ ' : ''}${formatShare(summary.limit.share)}`}
                {summary.limit.from !== null && <span className="strip__since">{t.strip.since(formatDay(summary.limit.from, false))}</span>}
              </dd>
            </div>
            <div>
              <dt>{t.strip.sessions}</dt>
              <dd>{summary.sessions}</dd>
            </div>
          </dl>
          <Sparkline values={summary.days} slot={summary.slot} label={formatRange(range)} />
          {tasks !== null && <TaskFacts tasks={tasks} onCard={onCard} />}
        </>
      )}
      <Link className="strip__more" to={`/stats?projects=${encodeURIComponent(project)}`}>
        {t.strip.more}
      </Link>
    </section>
  )
}

/** The middle finished task and the costliest ones; a narrow screen hides them, the strip keeps its spend. */
function TaskFacts({ tasks: { median, top }, onCard }: { tasks: StripTasks; onCard: (task: string) => void }) {
  if (median === null && top.length === 0) return null
  return (
    <dl className="strip__facts strip__tasks">
      {median !== null && (
        <div>
          <dt>{t.strip.median}</dt>
          <dd>
            <Tipped tip={t.strip.medianTip(median.count, DAYS)} inline>
              {formatUsd(median.cost)}
              {median.activeS !== null && <span className="strip__since"> · {formatDuration(median.activeS)}</span>}
            </Tipped>
          </dd>
        </div>
      )}
      {top.length > 0 && (
        <div>
          <dt>{t.strip.top}</dt>
          <dd className="strip__top">
            {top.map((row) => (
              <span key={row.task} className="strip__task">
                <Tipped tip={row.title ?? row.task} inline>
                  <button type="button" className="strip__key" onClick={() => onCard(row.task)}>
                    {row.task}
                  </button>
                </Tipped>
                <span className="strip__since">{formatUsd(row.cost)}</span>
              </span>
            ))}
          </dd>
        </div>
      )}
    </dl>
  )
}

/** Widths of each fact's label and value while reading, close to the loaded ones so nothing shifts when the numbers come. */
const BONES = [
  [28, 52],
  [88, 44],
  [48, 24],
]

/** The strip while the stats are read: the loaded strip's facts and sparkline, shimmering, at its height. */
function StripSkeleton() {
  return (
    <>
      <div className="strip__facts strip__facts--reading" role="status" aria-label={t.stats.reading}>
        {BONES.map(([label, value], index) => (
          <div key={index}>
            <span className="skeleton__block strip__bone--label" style={{ width: label }} />
            <span className="skeleton__block strip__bone--value" style={{ width: value }} />
          </div>
        ))}
      </div>
      <div className="strip__spark" aria-hidden="true">
        <div className="skeleton__block" />
      </div>
    </>
  )
}

function Sparkline({ values, slot, label }: { values: number[]; slot: number | null; label: string }) {
  const max = Math.max(0, ...values)
  return (
    <div className="strip__spark" style={seriesStyle(slot)} title={t.strip.spark(label)} aria-hidden="true">
      {values.map((value, index) => (
        <span key={index} style={{ height: max === 0 ? 0 : `${Math.max(4, (value / max) * 100)}%`, opacity: value === 0 ? 0 : 1 }} />
      ))}
    </div>
  )
}
