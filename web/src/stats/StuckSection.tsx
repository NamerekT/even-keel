import type { TrackerUrls } from '../../../src/state.js'
import type { StatsStuck, StatsWeekReason } from '../../../src/stats/model.js'
import { formatMoment } from '../format.js'
import { t } from '../i18n/index.js'
import { seriesStyle } from '../ui/series.js'
import { Section, TaskKey, type FoldControl } from './common.js'
import { kindLabel, reasonLabel } from './format.js'
import { formatDay } from './period.js'
import { stuckRemark } from './remarks.js'

export function StuckSection({
  weeks,
  stuck,
  trackerUrls,
  fold,
}: {
  weeks: StatsWeekReason[]
  stuck: StatsStuck[]
  trackerUrls: TrackerUrls
  fold: FoldControl
}) {
  const reasons = [...new Set(weeks.map((each) => each.reason))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
  const slot = (reason: string | null) => (reason === null ? null : reasons.indexOf(reason) + 1)
  const byWeek = [...new Set(weeks.map((each) => each.week))].sort()
  const totals = byWeek.map((week) => weeks.filter((each) => each.week === week).reduce((sum, each) => sum + each.spans, 0))
  const max = Math.max(0, ...totals)
  const now = new Date()
  const remark = stuckRemark(weeks)

  return (
    <Section title={t.stats.stuck.title} fold={fold} remark={remark && t.stats.remarks.stuck[remark.reason]} aside={<span className="stats-section__count">{totals.reduce((sum, each) => sum + each, 0)}</span>}>
      {stuck.length === 0 && weeks.length === 0 ? (
        <p className="placeholder">{t.stats.stuck.none}</p>
      ) : (
        <>
          <ul className="chart__legend">
            {reasons.map((reason) => (
              <li key={reason ?? ''} className="sources__key" style={seriesStyle(slot(reason))}>
                <span className="chart__swatch" aria-hidden="true" />
                {reasonLabel(reason)}
                <span className="chart__key-count">{weeks.filter((each) => each.reason === reason).reduce((sum, each) => sum + each.spans, 0)}</span>
              </li>
            ))}
          </ul>
          <div className="stuck-weeks">
            {byWeek.map((week, index) => (
              <div key={week} className="stuck-weeks__column" title={t.stats.stuck.week(formatDay(week), String(totals[index]))}>
                <div className="stuck-weeks__track">
                  <div className="chart__stack" style={{ height: `${(totals[index]! / max) * 100}%` }}>
                    {reasons.map((reason) => {
                      const spans = weeks.find((each) => each.week === week && each.reason === reason)?.spans ?? 0
                      return spans > 0 ? <span key={reason ?? ''} className="chart__segment" style={{ ...seriesStyle(slot(reason)), flexGrow: spans }} /> : null
                    })}
                  </div>
                </div>
                <span className="chart__day">{formatDay(week, false)}</span>
              </div>
            ))}
          </div>
          <h3 className="sources__title">{t.stats.stuck.latest}</h3>
          <ul className="stuck-list">
            {stuck.map((row) => (
              <li key={row.id} className="stuck-list__item">
                <span className="stuck-list__head">
                  {row.task === null ? <span className="stats__key stats__key--none">{t.stats.noTask}</span> : <TaskKey id={row.task} trackerUrls={trackerUrls} />}
                  {row.project !== null && <span className="stuck-list__project">{row.project}</span>}
                  <span className="stuck-list__when">{formatMoment(row.toAt, now)}</span>
                  <span className="stuck-list__kinds">{row.kinds.map(kindLabel).join(', ')}</span>
                </span>
                <span className="stuck-list__facts">
                  <strong>{reasonLabel(row.reason)}</strong>
                  {row.note !== null && row.note !== '' && ` — ${row.note}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}
