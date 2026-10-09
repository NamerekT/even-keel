import type { CompareFamily, FamilySums, StatsCompare } from '../../../src/stats/rules.js'
import { t } from '../i18n/index.js'
import { formatDuration, formatRatio, formatUsd, modelLabel } from './format.js'

interface RowProps {
  family: CompareFamily
  side: 'before' | 'after'
  sums: FamilySums
  minTasks: number
}

function SideRow({ family, side, sums, minTasks }: RowProps) {
  const words = t.stats.compare.families
  const first = side === 'before'
  return (
    <tr className={first ? 'family-compare__first' : undefined}>
      {first && (
        <td rowSpan={2} className="family-compare__nowrap">
          {family.family === null ? words.unknown : modelLabel(family.family)}
          {family.thin && (
            <span className="rule-compare__sample family-compare__thin" title={words.thinTitle(minTasks)}>
              {words.thin}
            </span>
          )}
        </td>
      )}
      <td className="family-compare__nowrap">{t.stats.compare[side]}</td>
      <td>
        <span className="rule-compare__value">{sums.tasks}</span>
        <span className="rule-compare__sample">{words.closed(sums.closed)}</span>
      </td>
      <td className="rule-compare__value">{formatUsd(sums.cost)}</td>
      <td className="rule-compare__value">{sums.closedCost === null ? '—' : formatUsd(sums.closedCost)}</td>
      <td className="rule-compare__value">{sums.closedMinutes === null ? '—' : formatDuration(sums.closedMinutes * 60)}</td>
      <td>
        <span className="rule-compare__value">{formatRatio(sums.ratio)}</span>
        <span className="rule-compare__sample">{words.estimated(sums.estimated)}</span>
      </td>
    </tr>
  )
}

export function FamilyCompare({ compare }: { compare: StatsCompare }) {
  if (compare.families.length === 0) return null
  const words = t.stats.compare.families
  return (
    <>
      <h4 className="family-compare__title">{words.title}</h4>
      <table className="tasks family-compare">
        <thead>
          <tr>
            <th>{words.model}</th>
            <th className="family-compare__nowrap">{words.side}</th>
            <th>{words.tasks}</th>
            <th>{words.cost}</th>
            <th>{words.closedCost}</th>
            <th>{words.closedTime}</th>
            <th>{words.ratio}</th>
          </tr>
        </thead>
        <tbody>
          {compare.families.map((family) =>
            (['before', 'after'] as const).map((side) => (
              <SideRow key={`${family.family}-${side}`} family={family} side={side} sums={family[side]} minTasks={compare.minTasks} />
            )),
          )}
        </tbody>
      </table>
      <p className="stats-section__note">{words.note}</p>
    </>
  )
}
