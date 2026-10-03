import type { StatsTaskRow } from '../../../src/stats/model.js'
import { plural } from '../format.js'
import { accuracy, type AccuracyGroup } from './accuracy.js'
import { Section } from './common.js'
import { formatDuration, formatRatio, formatShare, modelLabel } from './format.js'
import { Tile } from './Summary.js'

const BREAKDOWNS: { key: 'project' | 'component' | 'model'; title: string; label: (key: string | null) => string }[] = [
  { key: 'project', title: 'Проект', label: (key) => key ?? '—' },
  { key: 'component', title: 'Компонент', label: (key) => key ?? 'без компонента' },
  { key: 'model', title: 'Модель', label: (key) => (key === null ? 'неизвестно' : modelLabel(key)) },
]

export function EstimateSection({ tasks }: { tasks: StatsTaskRow[] }) {
  const result = accuracy(tasks)
  if (result.done === 0 && result.open === 0) return null
  const skipped = [
    result.unestimated > 0 && `без оценки: ${result.unestimated}`,
    result.open > 0 && `не закрыто: ${result.open}`,
  ].filter(Boolean)

  return (
    <Section
      title="Время и оценки"
      aside={<span className="stats-section__note">время — активная работа агента по ходам, за всю задачу; в сравнении только закрытые задачи с оценкой</span>}
    >
      <div className="stats-tiles">
        <Tile label="Медиана времени задачи" value={formatDuration(result.medianS)}>
          {result.done} {plural(result.done, 'закрытая задача', 'закрытые задачи', 'закрытых задач')}
        </Tile>
        <Tile label="В пределах ×1.5 от оценки" value={formatShare(result.within)}>
          сравнено {result.compared} {plural(result.compared, 'задача', 'задачи', 'задач')}
          {skipped.length > 0 && ` · ${skipped.join(' · ')}`}
        </Tile>
        <Tile label="Факт / оценка, медиана" value={formatRatio(result.ratio)}>
          {result.ratio === null ? 'нет задач с оценкой' : result.ratio < 1 ? 'быстрее оценки' : result.ratio > 1 ? 'дольше оценки' : 'ровно по оценке'}
        </Tile>
      </div>
      {result.compared > 0 && (
        <div className="estimates">
          {BREAKDOWNS.map((breakdown) => (
            <Breakdown key={breakdown.key} title={breakdown.title} groups={result.groups[breakdown.key]} label={breakdown.label} />
          ))}
        </div>
      )}
    </Section>
  )
}

function Breakdown({ title, groups, label }: { title: string; groups: AccuracyGroup[]; label: (key: string | null) => string }) {
  return (
    <div className="estimates__scroll">
      <table className="tasks estimates__table">
        <thead>
          <tr>
            <th scope="col">{title}</th>
            <th scope="col" className="tasks__num" title="Сравнено задач">
              Задачи
            </th>
            <th scope="col" className="tasks__num" title="Доля задач в пределах ×1.5 от оценки">
              ×1.5
            </th>
            <th scope="col" className="tasks__num" title="Медиана факт / оценка">
              Медиана
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key ?? ''}>
              <td>{label(group.key)}</td>
              <td className="tasks__num">{group.tasks}</td>
              <td className="tasks__num">{formatShare(group.within)}</td>
              <td className="tasks__num">{formatRatio(group.ratio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
