import type { ReactNode } from 'react'
import type { StatsPeriod, StatsShare } from '../../../src/stats/model.js'
import { plural } from '../format.js'
import { seriesStyle } from '../ui/series.js'
import { Section } from './common.js'
import { costChange, entrypointLabel, formatShare, formatUsd, limitWindows, modelLabel, weeklyLimit, type WeeklyLimit } from './format.js'
import { dayCount, formatDay, formatRange, previousRange, type DayRange } from './period.js'

export function Tiles({ period, range }: { period: StatsPeriod; range: DayRange }) {
  const { current, previous } = period
  const change = costChange(current.cost, previous.cost)
  const days = dayCount(range)
  const limit = weeklyLimit(current.limit, range, period.limits)
  const windows = days > 7 ? limitWindows(period.windows) : null
  const stuckShare = current.cost > 0 ? (current.stuckCost / current.cost) * 100 : null

  return (
    <div className="stats-tiles">
      <Tile label="Деньги" value={formatUsd(current.cost)}>
        {change === null ? 'прошлого отрезка нет' : <span title={formatRange(previousRange(range))}>{change} к прошлым {days} {plural(days, 'дню', 'дням', 'дням')}</span>}
        {current.unpriced > 0 && ` · ${current.unpriced} без цены`}
      </Tile>
      <Tile label="Недельный лимит" value={limit.share === null ? '—' : `${limit.perWeek ? '≈ ' : ''}${formatShare(limit.share)}`}>
        {limitNote(limit)}
        {windows !== null && <span className="stats-tile__line">{windows}</span>}
      </Tile>
      <Tile label="Задачи / сессии" value={`${current.tasks} / ${current.sessions}`}>
        {current.messages.toLocaleString('ru')} {plural(current.messages, 'ответ', 'ответа', 'ответов')}
      </Tile>
      <Tile label="Ушло на буксование" value={`${formatUsd(current.stuckCost)} · ${formatShare(stuckShare)}`}>
        ответы внутри отрезков застревания
      </Tile>
    </div>
  )
}

function limitNote(limit: WeeklyLimit): string {
  if (limit.share === null) return 'нет данных: снимков лимита за период нет'
  const span = [limit.from && `с ${formatDay(limit.from, false)}`, limit.to && `по ${formatDay(limit.to, false)}`].filter(Boolean).join(' ')
  if (limit.perWeek) return `в среднем за неделю${span && ` ${span}`}`
  return `сумма долей ${span || 'за период'}`
}

export function Tile({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="stats-tile">
      <span className="stats-tile__label">{label}</span>
      <span className="stats-tile__value">{value}</span>
      <span className="stats-tile__note">{children}</span>
    </div>
  )
}

export function Sources({ period }: { period: StatsPeriod }) {
  if (period.current.cost === 0) return null
  return (
    <Section title="Откуда расход">
      <div className="sources">
        <ShareBar title="Модель" shares={period.models} label={modelLabel} />
        <ShareBar title="Точка входа" shares={period.entrypoints} label={entrypointLabel} />
      </div>
    </Section>
  )
}

function ShareBar({ title, shares, label }: { title: string; shares: StatsShare[]; label: (key: string) => string }) {
  const total = shares.reduce((sum, each) => sum + each.cost, 0)
  const shown = shares.filter((each) => each.cost > 0)
  const slot = (index: number) => (index < 8 ? index + 1 : null)
  return (
    <div className="sources__row">
      <h3 className="sources__title">{title}</h3>
      <div className="sources__bar" aria-hidden="true">
        {shown.map((each, index) => (
          <span key={each.key} style={{ ...seriesStyle(slot(index)), flexGrow: each.cost }} />
        ))}
      </div>
      <ul className="chart__legend">
        {shown.map((each, index) => (
          <li key={each.key} className="sources__key" style={seriesStyle(slot(index))}>
            <span className="chart__swatch" aria-hidden="true" />
            {label(each.key)}
            <span className="chart__key-count">
              {formatUsd(each.cost)} · {formatShare(total > 0 ? (each.cost / total) * 100 : null)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
