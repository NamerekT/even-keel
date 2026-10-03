import { useMemo } from 'react'
import { Link } from 'react-router'
import type { StatsFilter } from '../../../src/stats/model.js'
import { useLive } from '../live/context.js'
import { AnswerNotice, loadedData, useStatsAnswer } from '../stats/common.js'
import { formatShare, formatUsd, weeklyLimit } from '../stats/format.js'
import { chartData, projectColors } from '../stats/history.js'
import { formatDay, formatRange, localDay, resolvePeriod } from '../stats/period.js'
import { seriesStyle } from '../ui/series.js'
import '../stats/stats.css'

const DAYS = 30

export function StatsStrip({ project }: { project: string }) {
  const { statsHistory } = useLive()
  const filter: StatsFilter = useMemo(() => ({ scope: 'all', account: null, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }), [])
  const loaded = useStatsAnswer(JSON.stringify(filter), () => statsHistory(filter))
  const history = loadedData(loaded)
  const range = resolvePeriod({ preset: '30d' }, localDay(new Date()), null)

  const summary = useMemo(() => {
    if (history === null) return null
    const index = history.projects.indexOf(project)
    const cells = history.cells.filter(([day, at]) => at === index && history.days[day]! >= range.from && history.days[day]! <= range.to)
    const sum = (column: 2 | 3 | 4) => cells.reduce((total, cell) => total + cell[column], 0)
    return {
      cost: sum(2),
      sessions: sum(3),
      limit: weeklyLimit(cells.length === 0 ? null : sum(4), range, history.limits),
      days: chartData(history, range, 'day', 'cost', [project]).buckets.map((each) => each.total),
      slot: projectColors(history).get(project) ?? null,
    }
  }, [history, project, range.from])

  return (
    <section className="strip" aria-label={`Расход ${project} за ${DAYS} дней`}>
      {summary === null ? (
        <AnswerNotice loaded={loaded} />
      ) : (
        <>
          <dl className="strip__facts">
            <div>
              <dt>Деньги</dt>
              <dd>{formatUsd(summary.cost)}</dd>
            </div>
            <div>
              <dt>Лимит в неделю</dt>
              <dd title={summary.limit.share === null ? 'снимков лимита за 30 дней нет' : undefined}>
                {summary.limit.share === null ? '—' : `${summary.limit.perWeek ? '≈ ' : ''}${formatShare(summary.limit.share)}`}
                {summary.limit.from !== null && <span className="strip__since"> с {formatDay(summary.limit.from, false)}</span>}
              </dd>
            </div>
            <div>
              <dt>Сессии</dt>
              <dd>{summary.sessions}</dd>
            </div>
          </dl>
          <Sparkline values={summary.days} slot={summary.slot} label={formatRange(range)} />
        </>
      )}
      <Link className="strip__more" to={`/stats?projects=${encodeURIComponent(project)}`}>
        Подробнее →
      </Link>
    </section>
  )
}

function Sparkline({ values, slot, label }: { values: number[]; slot: number | null; label: string }) {
  const max = Math.max(0, ...values)
  return (
    <div className="strip__spark" style={seriesStyle(slot)} title={`${label}, по дням`} aria-hidden="true">
      {values.map((value, index) => (
        <span key={index} style={{ height: max === 0 ? 0 : `${Math.max(4, (value / max) * 100)}%`, opacity: value === 0 ? 0 : 1 }} />
      ))}
    </div>
  )
}
