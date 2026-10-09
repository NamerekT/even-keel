import type { CompareSide, StatsCompare } from '../../../src/stats/rules.js'
import { formatMoment, formatTokens } from '../format.js'
import { t } from '../i18n/index.js'
import { FamilyCompare } from './FamilyCompare.js'
import { costChange, formatUsd, modelVersionLabel } from './format.js'

type Sample = 'tasks' | 'sessions' | 'requests'

const ROWS: [keyof CompareSide, Sample, (value: number) => string][] = [
  ['taskCost', 'tasks', formatUsd],
  ['sessionsPerTask', 'tasks', (value) => value.toFixed(2)],
  ['meanContext', 'requests', formatTokens],
  ['over150Share', 'requests', percent],
  ['requestCost', 'requests', (value) => `$${value.toFixed(3)}`],
  ['stuckShare', 'sessions', percent],
  ['errorShare', 'sessions', percent],
  ['deniedShare', 'sessions', percent],
  ['entryTokens', 'sessions', formatTokens],
]

function percent(share: number): string {
  const value = share * 100
  return t.units.percent(String(value < 10 ? value.toFixed(1) : Math.round(value)))
}

function sideRange(side: CompareSide, now: Date): string {
  return `${formatMoment(side.from, now)} — ${formatMoment(side.to, now)}`
}

function modelMix(side: CompareSide): string {
  if (side.models.length === 0) return '—'
  return side.models
    .map((each) => `${modelVersionLabel(each.model)} ${t.units.percent(each.share < 0.005 ? '< 1' : String(Math.round(each.share * 100)))}`)
    .join(', ')
}

export const COMPARE_DAYS = [3, 7, 14, 30]

export function RuleCompare({ compare }: { compare: StatsCompare }) {
  const now = new Date()
  const { before, after } = compare
  return (
    <div className="rule-compare">
      {compare.thin && <p className="notice notice--warn">{t.stats.compare.few(compare.minTasks, compare.minSessions)}</p>}
      {compare.modelShift && <p className="notice notice--warn">{t.stats.compare.models}</p>}
      <table className="tasks rule-compare__table">
        <thead>
          <tr>
            <th>{t.stats.compare.metric}</th>
            <th>
              {t.stats.compare.before}
              <span className="rule-compare__range">{sideRange(before, now)}</span>
            </th>
            <th>
              {t.stats.compare.after}
              <span className="rule-compare__range">{sideRange(after, now)}</span>
            </th>
            <th>{t.stats.compare.change}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([key, kind, format]) => {
            const was = before[key] as number | null
            const next = after[key] as number | null
            const change = was === null || next === null ? null : costChange(next, was)
            return (
              <tr key={key}>
                <td>{t.stats.compare.metrics[key]}</td>
                <td>
                  <span className="rule-compare__value">{was === null ? '—' : format(was)}</span>
                  <span className="rule-compare__sample">{t.stats.compare.samples[kind](before[kind])}</span>
                </td>
                <td>
                  <span className="rule-compare__value">{next === null ? '—' : format(next)}</span>
                  <span className="rule-compare__sample">{t.stats.compare.samples[kind](after[kind])}</span>
                </td>
                <td className={change === null ? undefined : change.startsWith('+') ? 'rule-compare__worse' : change.startsWith('−') ? 'rule-compare__better' : undefined}>
                  {change ?? '—'}
                </td>
              </tr>
            )
          })}
          <tr>
            <td>{t.stats.compare.modelShares}</td>
            <td>{modelMix(before)}</td>
            <td>{modelMix(after)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <p className="stats-section__note">{t.stats.compare.foot}</p>
      <FamilyCompare compare={compare} />
    </div>
  )
}
