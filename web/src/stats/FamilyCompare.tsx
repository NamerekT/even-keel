import type { CompareFamily, FamilySums, StatsCompare } from '../../../src/stats/rules.js'
import { t } from '../i18n/index.js'
import { HelpTip } from '../pages/settingsParts.js'
import { costChange, formatDuration, formatRatio, formatUsd, modelLabel } from './format.js'

interface RowProps {
  family: CompareFamily
  side: 'before' | 'after'
  sums: FamilySums
  minTasks: number
  beside: boolean
}

function SideRow({ family, side, sums, minTasks, beside }: RowProps) {
  const words = t.stats.compare.families
  const first = side === 'before'
  return (
    <tr className={`${first ? 'family-compare__first' : ''}${family.thin ? ' family-compare--thin' : ''}`}>
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
      <td className="family-compare__nowrap">{beside ? t.stats.compare[first ? 'left' : 'right'] : t.stats.compare[side]}</td>
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
      {first && <td rowSpan={2} className="family-compare__delta">
        <span>{words.closedCost}: {family.thin || family.before.closedCost === null || family.after.closedCost === null ? '—' : costChange(family.after.closedCost, family.before.closedCost) ?? '—'}</span>
        <span>{words.closedTime}: {family.thin || family.before.closedMinutes === null || family.after.closedMinutes === null ? '—' : costChange(family.after.closedMinutes, family.before.closedMinutes) ?? '—'}</span>
      </td>}
    </tr>
  )
}

export function FamilyCompare({ compare, beside = false }: { compare: StatsCompare; beside?: boolean }) {
  if (compare.families.length === 0) return null
  const words = t.stats.compare.families
  return (
    <>
      <div className="rule-card__head"><h4 className="family-compare__title">{words.title}</h4><HelpTip text={words.note} /></div>
      <div className="tasks__scroll"><table className="tasks family-compare">
        <thead>
          <tr>
            <th>{words.model}</th>
            <th className="family-compare__nowrap">{words.side}</th>
            <th>{words.tasks}</th>
            <th>{words.cost}</th>
            <th>{words.closedCost}</th>
            <th>{words.closedTime}</th>
            <th>{words.ratio}</th>
            <th>{t.stats.compare.change}</th>
          </tr>
        </thead>
        <tbody>
          {[...compare.families].sort((a, b) => Number(a.thin) - Number(b.thin)).map((family) =>
            (['before', 'after'] as const).map((side) => (
              <SideRow key={`${family.family}-${side}`} family={family} side={side} sums={family[side]} minTasks={compare.minTasks} beside={beside} />
            )),
          )}
        </tbody>
      </table></div>
    </>
  )
}
