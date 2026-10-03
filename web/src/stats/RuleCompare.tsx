import type { CompareSide, StatsCompare } from '../../../src/stats/rules.js'
import { formatMoment, formatTokens, plural } from '../format.js'
import { costChange, formatUsd, modelVersionLabel } from './format.js'

type Sample = 'tasks' | 'sessions' | 'requests'

const ROWS: [keyof CompareSide, string, Sample, (value: number) => string][] = [
  ['taskCost', 'Цена задачи, медиана', 'tasks', formatUsd],
  ['sessionsPerTask', 'Сессий на задачу', 'tasks', (value) => value.toFixed(2)],
  ['meanContext', 'Средний контекст на запрос', 'requests', formatTokens],
  ['over150Share', 'Запросов больше 150k', 'requests', percent],
  ['requestCost', '$ за запрос', 'requests', (value) => `$${value.toFixed(3)}`],
  ['stuckShare', 'Расход в застреваниях', 'sessions', percent],
  ['errorShare', 'Падения инструментов', 'sessions', percent],
  ['deniedShare', 'Отказы инструментов', 'sessions', percent],
  ['entryTokens', 'Стоимость входа: контекст первого ответа, медиана', 'sessions', formatTokens],
]

const SAMPLES: Record<Sample, [string, string, string]> = {
  tasks: ['задача', 'задачи', 'задач'],
  sessions: ['сессия', 'сессии', 'сессий'],
  requests: ['запрос', 'запроса', 'запросов'],
}

function percent(share: number): string {
  const value = share * 100
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} %`
}

function sideRange(side: CompareSide, now: Date): string {
  return `${formatMoment(side.from, now)} — ${formatMoment(side.to, now)}`
}

function sample(side: CompareSide, kind: Sample): string {
  const count = side[kind]
  return `${count} ${plural(count, ...SAMPLES[kind])}`
}

function modelMix(side: CompareSide): string {
  if (side.models.length === 0) return '—'
  return side.models.map((each) => `${modelVersionLabel(each.model)} ${each.share < 0.005 ? '< 1' : Math.round(each.share * 100)} %`).join(', ')
}

export const COMPARE_DAYS = [3, 7, 14, 30]

export function RuleCompare({ compare }: { compare: StatsCompare }) {
  const now = new Date()
  const { before, after } = compare
  return (
    <div className="rule-compare">
      {compare.thin && (
        <p className="notice notice--warn">
          Мало данных: для сравнения нужно не меньше {compare.minTasks} задач и {compare.minSessions} сессий с каждой стороны.
        </p>
      )}
      {compare.modelShift && (
        <p className="notice notice--warn">
          Модели сторон разные, а цена токена у моделей своя: долларовые строки меняются и без правки. Контекст и доли от этого не зависят.
        </p>
      )}
      <table className="tasks rule-compare__table">
        <thead>
          <tr>
            <th>Метрика</th>
            <th>
              До<span className="rule-compare__range">{sideRange(before, now)}</span>
            </th>
            <th>
              После<span className="rule-compare__range">{sideRange(after, now)}</span>
            </th>
            <th>Изменение</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([key, label, kind, format]) => {
            const was = before[key] as number | null
            const next = after[key] as number | null
            const change = was === null || next === null ? null : costChange(next, was)
            return (
              <tr key={key}>
                <td>{label}</td>
                <td>
                  <span className="rule-compare__value">{was === null ? '—' : format(was)}</span>
                  <span className="rule-compare__sample">{sample(before, kind)}</span>
                </td>
                <td>
                  <span className="rule-compare__value">{next === null ? '—' : format(next)}</span>
                  <span className="rule-compare__sample">{sample(after, kind)}</span>
                </td>
                <td className={change === null ? undefined : change.startsWith('+') ? 'rule-compare__worse' : change.startsWith('−') ? 'rule-compare__better' : undefined}>
                  {change ?? '—'}
                </td>
              </tr>
            )
          })}
          <tr>
            <td>Модели, доля запросов</td>
            <td>{modelMix(before)}</td>
            <td>{modelMix(after)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <p className="stats-section__note">
        Меньше — лучше во всех строках. Задача относится к стороне своего первого сообщения, сессия — к стороне начала; другой набор
        задач по сторонам тоже меняет цифры.
      </p>
    </div>
  )
}
