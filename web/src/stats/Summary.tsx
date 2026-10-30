import type { CSSProperties } from 'react'
import { MIN_HANDOFFS, MIN_SESSIONS, type CheckpointThreshold } from '../../../src/stats/checkpoint.js'
import type { StatsPeriod, StatsShare } from '../../../src/stats/model.js'
import { folderLabel } from '../accountName.js'
import { formatTokens } from '../format.js'
import { useLive } from '../live/context.js'
import { language, t } from '../i18n/index.js'
import { Tile, TileGrid } from '../ui/blocks.js'
import { Fold } from '../ui/Fold.js'
import { Tipped } from '../ui/Tipped.js'
import { TONES, toneStyle } from '../ui/series.js'
import { Section, type FoldControl } from './common.js'
import {
  costChange,
  entrypointLabel,
  formatRatio,
  formatShare,
  formatUsd,
  limitAccounts,
  modelLabel,
  weeklyLimit,
  type AccountWindows,
  type WeeklyLimit,
} from './format.js'
import { dayCount, formatDay, formatRange, previousRange, type DayRange } from './period.js'
import { sourcesRemark, stampOf, type Stamp } from './remarks.js'

export function Tiles({ period, range }: { period: StatsPeriod; range: DayRange }) {
  const { current, previous } = period
  const change = costChange(current.cost, previous.cost)
  const days = dayCount(range)
  const limit = weeklyLimit(current.limit, range, period.limits)
  const stuckShare = current.cost > 0 ? (current.stuckCost / current.cost) * 100 : null
  const stamp = stampOf(current, previous)

  return (
    <TileGrid className="stats-tiles--stamped">
      {stamp !== null && <StampMark key={`${stamp.kind}:${period.query.from}:${period.query.to}`} stamp={stamp} />}
      <Tile
        label={t.stats.summary.cost}
        value={formatUsd(current.cost)}
        note={
          <>
            {change === null ? (
              t.stats.summary.noPrevious
            ) : (
              <span title={formatRange(previousRange(range))}>{t.stats.summary.change(change, days)}</span>
            )}
            {current.unpriced > 0 && t.stats.summary.unpriced(current.unpriced)}
          </>
        }
      />
      <Tile
        label={t.stats.summary.limit}
        value={limit.share === null ? '—' : `${limit.perWeek ? '≈ ' : ''}${formatShare(limit.share)}`}
        note={limitNote(limit)}
      />
      <Tile
        label={t.stats.summary.tasks}
        value={`${current.tasks} / ${current.sessions}`}
        note={`${current.messages.toLocaleString(language)} ${t.stats.summary.answers(current.messages)}`}
      />
      <Tile label={t.stats.summary.stuck} value={`${formatUsd(current.stuckCost)} · ${formatShare(stuckShare)}`} note={t.stats.summary.stuckNote} />
    </TileGrid>
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

function LimitAccounts({ rows }: { rows: AccountWindows[] }) {
  const { state } = useLive()
  const { summary } = t.stats
  const closed = rows.some((each) => each.closed.length > 0)
  const open = rows.some((each) => each.open.length > 0)
  const peaks = (list: number[], label?: string) =>
    list.map((peak, index) => (
      <span
        key={index}
        className="limit-accounts__peak"
        style={{ '--peak': `${Math.min(100, peak)}%` } as CSSProperties}
        aria-label={label && `${formatShare(peak)} ${label}`}
      >
        {formatShare(peak)}
      </span>
    ))
  return (
    <ul className="limit-accounts">
      <li className="limit-accounts__head" aria-hidden="true">
        <span>{summary.windows}</span>
        {closed && <span>{summary.closed}</span>}
        {open && <span>{summary.open}</span>}
      </li>
      {rows.map((row) => (
        <li key={row.account}>
          <span className="limit-accounts__name" title={row.account}>
            {folderLabel(state?.account, row.account)}
          </span>
          {closed && <span className="limit-accounts__peaks">{peaks(row.closed)}</span>}
          {open && <span className="limit-accounts__peaks limit-accounts__peaks--open">{peaks(row.open, summary.open)}</span>}
        </li>
      ))}
    </ul>
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

export function Limits({ period, range, fold }: { period: StatsPeriod; range: DayRange; fold: FoldControl }) {
  const rows = dayCount(range) > 7 ? limitAccounts(period.windows) : []
  if (rows.length === 0) return null
  return <Section title={t.stats.summary.limitsByAccount} fold={fold} aside={<span className="stats-section__count">{rows.length}</span>}>
    <LimitAccounts rows={rows} />
  </Section>
}

export function Checkpoints({ thresholds, projects, fold }: { thresholds: CheckpointThreshold[]; projects: string[] | null; fold: FoldControl }) {
  const shown = thresholds.filter((each) => projects === null || projects.includes(each.project))
  if (shown.length === 0) return null
  const waiting = (each: CheckpointThreshold) => t.stats.checkpoint.waiting(each.handoffs, each.sessions, MIN_HANDOFFS, MIN_SESSIONS)
  return (
    <Section title={t.stats.checkpoint.title} fold={fold} help={t.stats.checkpoint.note} aside={<span className="stats-section__count">{shown.length}</span>}>
      <ul className="checkpoints">
        {shown.filter(each => each.source !== 'default').map((each) => (
          <li key={each.project} title={each.source === 'default' ? waiting(each) : undefined}>
            <span className="checkpoints__project">{each.project}</span>
            <span className="checkpoints__first">{formatTokens(each.first)}</span>
            <span className="checkpoints__source">{t.stats.checkpoint.sources[each.source](each.handoffs)}</span>
          </li>
        ))}
      </ul>
      {shown.some(each => each.source === 'default') && <Tipped focusable tip={shown.filter(each => each.source === 'default').map(each => <div key={each.project}>{each.project}: {waiting(each)}</div>)}>
        <span className="stats-section__note">{t.stats.checkpoint.defaults(shown.filter(each => each.source === 'default').length)}</span>
      </Tipped>}
    </Section>
  )
}

function ShareBar({ title, shares, label }: { title: string; shares: StatsShare[]; label: (key: string) => string }) {
  const total = shares.reduce((sum, each) => sum + each.cost, 0)
  const shown = shares.filter((each) => each.cost > 0)
  const major = shown.filter(each => each.cost / total >= 0.01)
  const tail = shown.filter(each => each.cost / total < 0.01)
  const slot = (index: number) => (index < TONES ? index + 1 : null)
  return (
    <div className="sources__row">
      <h3 className="sources__title">{title}</h3>
      <div className="sources__bar" aria-hidden="true">
        {shown.map((each, index) => (
          <span key={each.key} style={{ ...toneStyle(slot(index)), flexGrow: each.cost }} />
        ))}
      </div>
      <ul className="chart__legend">
        {major.map((each) => (
          <li key={each.key} className="sources__key" style={toneStyle(slot(shown.indexOf(each)))}>
            <span className="chart__swatch" aria-hidden="true" />
            {label(each.key)}
            <span className="chart__key-count">
              {formatUsd(each.cost)} · {formatShare(total > 0 ? (each.cost / total) * 100 : null)}
            </span>
          </li>
        ))}
      </ul>
      {tail.length > 0 && <Fold summary={<Tipped inline tip={tail.map(each => <span key={each.key}>{label(each.key)}: {formatUsd(each.cost)} · {formatShare(each.cost / total * 100)}<br /></span>)}><span>{t.stats.others} · {formatShare(tail.reduce((sum, each) => sum + each.cost, 0) / total * 100)}</span></Tipped>}>
        <ul className="chart__legend">{tail.map(each => <li key={each.key} className="sources__key" style={toneStyle(slot(shown.indexOf(each)))}>
          <span className="chart__swatch" aria-hidden="true" />{label(each.key)}
          <span className="chart__key-count">{formatUsd(each.cost)} · {formatShare(each.cost / total * 100)}</span>
        </li>)}</ul>
      </Fold>}
    </div>
  )
}
