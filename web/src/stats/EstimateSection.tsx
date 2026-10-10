import type { StatsTaskRow } from '../../../src/stats/model.js'
import { t } from '../i18n/index.js'
import { accuracy, type AccuracyGroup } from './accuracy.js'
import { Section, type FoldControl } from './common.js'
import { formatDuration, formatRatio, formatShare, modelLabel } from './format.js'
import { estimateRemark, type EstimateRemark } from './remarks.js'
import { Tile } from './Summary.js'

type BreakdownKey = 'project' | 'component' | 'model'

const BREAKDOWNS: { key: BreakdownKey; label: (key: string | null) => string }[] = [
  { key: 'project', label: (key) => key ?? '—' },
  { key: 'component', label: (key) => key ?? t.stats.estimate.noComponent },
  { key: 'model', label: (key) => (key === null ? t.stats.estimate.unknown : modelLabel(key)) },
]

export function EstimateSection({ tasks, fold }: { tasks: StatsTaskRow[]; fold: FoldControl }) {
  const result = accuracy(tasks)
  if (result.done === 0 && result.open === 0) return null
  const skipped = [
    result.unestimated > 0 && t.stats.estimate.unestimated(result.unestimated),
    result.open > 0 && t.stats.estimate.open(result.open),
  ].filter(Boolean)

  return (
    <Section
      title={t.stats.estimate.title}
      fold={fold}
      remark={remarkText(estimateRemark(result))}
      aside={
        <>
          <span className="stats-section__count">{formatShare(result.within)}</span>
          <span className="stats-section__note">{t.stats.estimate.note}</span>
        </>
      }
    >
      <div className="stats-tiles">
        <Tile label={t.stats.estimate.median} value={formatDuration(result.medianS)}>
          {t.stats.estimate.done(result.done)}
        </Tile>
        <Tile label={t.stats.estimate.within} value={formatShare(result.within)}>
          {result.within2 !== null && `${t.stats.estimate.within2(formatShare(result.within2))} · `}
          {t.stats.estimate.compared(result.compared)}
          {skipped.length > 0 && ` · ${skipped.join(' · ')}`}
        </Tile>
        {result.baseline && (
          <Tile label={t.stats.estimate.baseline} value={formatShare(result.baseline.within)}>
            <span title={t.stats.estimate.baselineTitle}>
              {t.stats.estimate.baselineNote} · {t.stats.estimate.within2(formatShare(result.baseline.within2))}
            </span>
          </Tile>
        )}
        <Tile label={t.stats.estimate.ratio} value={formatRatio(result.ratio)}>
          {ratioNote(result.ratio)}
        </Tile>
      </div>
      {result.compared > 0 && (
        <div className="estimates">
          {BREAKDOWNS.map((breakdown) => (
            <Breakdown key={breakdown.key} title={t.stats.estimate[breakdown.key]} groups={result.groups[breakdown.key]} label={breakdown.label} />
          ))}
        </div>
      )}
    </Section>
  )
}

function remarkText(remark: EstimateRemark | null): string | null {
  if (remark === null) return null
  const { remarks } = t.stats
  if (remark.kind === 'optimist' || remark.kind === 'pessimist') return remarks[remark.kind](formatRatio(remark.ratio))
  return remarks[remark.kind]
}

function ratioNote(ratio: number | null): string {
  if (ratio === null) return t.stats.estimate.noEstimates
  if (ratio < 1) return t.stats.estimate.faster
  return ratio > 1 ? t.stats.estimate.slower : t.stats.estimate.exact
}

function Breakdown({ title, groups, label }: { title: string; groups: AccuracyGroup[]; label: (key: string | null) => string }) {
  return (
    <div className="estimates__scroll">
      <table className="tasks estimates__table">
        <thead>
          <tr>
            <th scope="col">{title}</th>
            <th scope="col" className="tasks__num" title={t.stats.estimate.comparedTitle}>
              {t.stats.estimate.tasks}
            </th>
            <th scope="col" className="tasks__num" title={t.stats.estimate.withinTitle}>
              ×1.5
            </th>
            <th scope="col" className="tasks__num" title={t.stats.estimate.within2Title}>
              ×2
            </th>
            <th scope="col" className="tasks__num" title={t.stats.estimate.baselineTitle}>
              {t.stats.estimate.baselineColumn}
            </th>
            <th scope="col" className="tasks__num" title={t.stats.estimate.medianTitle}>
              {t.stats.estimate.medianColumn}
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key ?? ''}>
              <td>{label(group.key)}</td>
              <td className="tasks__num">{group.tasks}</td>
              <td className="tasks__num">{formatShare(group.within)}</td>
              <td className="tasks__num">{formatShare(group.within2)}</td>
              <td className="tasks__num">{formatShare(group.baseline.within)}</td>
              <td className="tasks__num">{formatRatio(group.ratio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
