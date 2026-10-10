import type { ReactNode } from 'react'
import { MIN_HANDOFFS, MIN_SESSIONS, type CheckpointThreshold } from '../../../src/stats/checkpoint.js'
import type { StatsPeriod, StatsShare } from '../../../src/stats/model.js'
import { formatTokens } from '../format.js'
import { language, t } from '../i18n/index.js'
import { seriesStyle } from '../ui/series.js'
import { Section } from './common.js'
import { costChange, entrypointLabel, formatRatio, formatShare, formatUsd, limitWindows, modelLabel, weeklyLimit, type WeeklyLimit } from './format.js'
import { dayCount, formatDay, formatRange, previousRange, type DayRange } from './period.js'
import { sourcesRemark, stampOf, type Stamp } from './remarks.js'

export function Tiles({ period, range }: { period: StatsPeriod; range: DayRange }) {
  const { current, previous } = period
  const change = costChange(current.cost, previous.cost)
  const days = dayCount(range)
  const limit = weeklyLimit(current.limit, range, period.limits)
  const windows = days > 7 ? limitWindows(period.windows) : null
  const stuckShare = current.cost > 0 ? (current.stuckCost / current.cost) * 100 : null
  const stamp = stampOf(current, previous)

  return (
    <div className="stats-tiles stats-tiles--stamped">
      {stamp !== null && <StampMark key={`${stamp.kind}:${period.query.from}:${period.query.to}`} stamp={stamp} />}
      <Tile label={t.stats.summary.cost} value={formatUsd(current.cost)}>
        {change === null ? (
          t.stats.summary.noPrevious
        ) : (
          <span title={formatRange(previousRange(range))}>{t.stats.summary.change(change, days)}</span>
        )}
        {current.unpriced > 0 && t.stats.summary.unpriced(current.unpriced)}
      </Tile>
      <Tile label={t.stats.summary.limit} value={limit.share === null ? '—' : `${limit.perWeek ? '≈ ' : ''}${formatShare(limit.share)}`}>
        {limitNote(limit)}
        {windows !== null && <span className="stats-tile__line">{windows}</span>}
      </Tile>
      <Tile label={t.stats.summary.tasks} value={`${current.tasks} / ${current.sessions}`}>
        {current.messages.toLocaleString(language)} {t.stats.summary.answers(current.messages)}
      </Tile>
      <Tile label={t.stats.summary.stuck} value={`${formatUsd(current.stuckCost)} · ${formatShare(stuckShare)}`}>
        {t.stats.summary.stuckNote}
      </Tile>
    </div>
  )
}

const STAMP_TONE: Record<Stamp['kind'], 'good' | 'bad'> = { calm: 'good', overspend: 'bad', aground: 'bad', bargain: 'good', evenKeel: 'good' }

function StampMark({ stamp }: { stamp: Stamp }) {
  const { stamps } = t.stats
  const [word, caption] =
    stamp.kind === 'overspend'
      ? stamps.overspend(formatRatio(stamp.times))
      : stamp.kind === 'aground'
        ? stamps.aground(formatShare(stamp.share))
        : stamps[stamp.kind]
  return (
    <span className={`stats-stamp stats-stamp--${STAMP_TONE[stamp.kind]}`}>
      <span className="stats-stamp__word">{word}</span>
      <span className="stats-stamp__caption">{caption}</span>
    </span>
  )
}

function limitNote(limit: WeeklyLimit): string {
  if (limit.share === null) return t.stats.summary.noLimit
  const span = [limit.from && t.stats.summary.from(formatDay(limit.from, false)), limit.to && t.stats.summary.to(formatDay(limit.to, false))]
    .filter(Boolean)
    .join(' ')
  return limit.perWeek ? t.stats.summary.perWeek(span) : t.stats.summary.sum(span)
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
  const mono = sourcesRemark(period.models)
  return (
    <Section title={t.stats.summary.sources} remark={mono && t.stats.remarks.mono(modelLabel(mono.model))}>
      <div className="sources">
        <ShareBar title={t.stats.summary.model} shares={period.models} label={modelLabel} />
        <ShareBar title={t.stats.summary.entrypoint} shares={period.entrypoints} label={entrypointLabel} />
      </div>
    </Section>
  )
}

export function Checkpoints({ thresholds, projects }: { thresholds: CheckpointThreshold[]; projects: string[] | null }) {
  const shown = thresholds.filter((each) => projects === null || projects.includes(each.project))
  if (shown.length === 0) return null
  const waiting = (each: CheckpointThreshold) => t.stats.checkpoint.waiting(each.handoffs, each.sessions, MIN_HANDOFFS, MIN_SESSIONS)
  return (
    <Section title={t.stats.checkpoint.title} aside={<span className="stats-section__note">{t.stats.checkpoint.note}</span>}>
      <ul className="checkpoints">
        {shown.map((each) => (
          <li key={each.project} title={each.source === 'default' ? waiting(each) : undefined}>
            <span className="checkpoints__project">{each.project}</span>
            <span className="checkpoints__first">{formatTokens(each.first)}</span>
            <span className="checkpoints__source">{t.stats.checkpoint.sources[each.source](each.handoffs)}</span>
          </li>
        ))}
      </ul>
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
