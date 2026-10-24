import { useMemo } from 'react'
import { Link } from 'react-router'
import type { StatsFilter } from '../../../src/stats/model.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { AnswerNotice, loadedData, useStatsAnswer } from '../stats/common.js'
import { formatShare, formatUsd, weeklyLimit } from '../stats/format.js'
import { chartData } from '../stats/history.js'
import { formatDay, formatRange, localDay, resolvePeriod } from '../stats/period.js'
import { seriesStyle } from '../ui/series.js'
import '../stats/stats.css'

const DAYS = 30

export type StripData = ReturnType<typeof useStrip>

/** The project's last 30 days from the stats, drawn in its `slot`; the page reads it once for the strip and the idle panel. */
export function useStrip(project: string, slot: number | null) {
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
      days: chartData(history, range, 'day', 'cost', [project], new Map([[project, slot]])).buckets.map((each) => each.total),
      slot,
    }
  }, [history, project, slot, range.from])

  return { loaded, summary, range }
}

export function StatsStrip({ project, strip: { loaded, summary, range } }: { project: string; strip: StripData }) {
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
        </>
      )}
      <Link className="strip__more" to={`/stats?projects=${encodeURIComponent(project)}`}>
        {t.strip.more}
      </Link>
    </section>
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
