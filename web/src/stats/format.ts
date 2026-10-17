import type { LimitCoverage, StatsLimitWindow } from '../../../src/stats/model.js'
import { localized, t } from '../i18n/index.js'
import { dayCount, type DayRange } from './period.js'

const MODELS: Record<string, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
  gpt: 'GPT',
}

const ENTRYPOINTS: Record<string, string> = {
  chain: 'Even Keel',
  vscode: 'VS Code',
  cli: 'CLI',
  'tally-classify': 'Tally',
  codex: 'Codex',
  'codex-exec': 'Codex CLI',
  'codex-desktop': 'Codex Desktop',
}

const GROUPED = localized((language) => new Intl.NumberFormat(language, { maximumFractionDigits: 0 }))

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0'
  if (amount < 0.01) return '< $0.01'
  if (amount < 100) return `$${amount.toFixed(2)}`
  return `$${GROUPED().format(amount).replace(/\s/g, ' ')}`
}

export function costChange(cost: number, previous: number): string | null {
  if (previous <= 0) return null
  const percent = Math.round(((cost - previous) / previous) * 100)
  if (percent === 0) return t.units.percent('±0')
  return t.units.percent(percent > 0 ? `+${percent}` : `−${-percent}`)
}

export function formatShare(share: number | null): string {
  if (share === null) return '—'
  if (share === 0) return t.units.percent('0')
  if (share < 1) return t.units.percent('< 1')
  return t.units.percent(String(Math.round(share)))
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const { hour, minute } = t.units
  if (seconds === 0) return `0 ${minute}`
  if (seconds < 30) return `< 1 ${minute}`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} ${minute}`
  if (minutes >= 600) return `${Math.round(minutes / 60)} ${hour}`
  const rest = minutes % 60
  return rest === 0 ? `${minutes / 60} ${hour}` : `${Math.floor(minutes / 60)} ${hour} ${String(rest).padStart(2, '0')} ${minute}`
}

export function formatSeconds(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 10) return `${Number(seconds.toFixed(1))} ${t.units.second}`
  if (seconds < 120) return `${Math.round(seconds)} ${t.units.second}`
  if (seconds < 600) return `${Number((seconds / 60).toFixed(1))} ${t.units.minute}`
  return formatDuration(seconds)
}

export function formatRatio(ratio: number | null): string {
  if (ratio === null) return '—'
  return `×${ratio >= 10 ? Math.round(ratio) : Number(ratio.toFixed(1))}`
}

export function reasonLabel(reason: string | null): string {
  if (reason === null) return t.stats.labels.unsorted
  return t.stats.labels.reasons[reason] ?? reason
}

export function kindLabel(kind: string): string {
  return t.stats.labels.kinds[kind] ?? kind
}

export function launchLabel(reason: string | null): string {
  if (reason === null) return t.stats.labels.outsideChain
  return t.stats.labels.launches[reason] ?? reason
}

// 'claude-opus-5-5' → 'Opus 5.5', a trailing date dropped; anything not a Claude model stays as it is.
export function modelVersionLabel(model: string): string {
  const match = /^claude-([a-z]+)((?:-\d{1,2})+)(?:-\d{8})?$/.exec(model)
  if (match === null) return model
  return `${MODELS[match[1]!] ?? match[1]} ${match[2]!.slice(1).replaceAll('-', '.')}`
}

export function modelLabel(model: string): string {
  if (model === 'other') return t.stats.labels.otherModels
  return MODELS[model] ?? model
}

export function entrypointLabel(entrypoint: string): string {
  if (entrypoint === 'desktop') return t.stats.labels.desktop
  if (entrypoint === 'other') return t.stats.labels.otherEntrypoint
  return ENTRYPOINTS[entrypoint] ?? entrypoint
}

export interface WeeklyLimit {
  share: number | null
  perWeek: boolean
  from: string | null
  to: string | null
}

// share is the sum of the limit shares in the range; only the days covered by limit snapshots count,
// from and to are set where the coverage starts after or ends before the range.
export function weeklyLimit(share: number | null, range: DayRange, limits: LimitCoverage | null): WeeklyLimit {
  const from = limits === null || limits.from < range.from ? range.from : limits.from
  const to = limits === null || limits.to > range.to ? range.to : limits.to
  if (limits === null || from > to) return { share: null, perWeek: false, from: null, to: null }
  const days = dayCount({ from, to })
  const total = share ?? 0
  return {
    share: days > 7 ? (total * 7) / days : total,
    perWeek: days > 7,
    from: from > range.from ? from : null,
    to: to < range.to ? to : null,
  }
}

export interface AccountWindows {
  account: string
  closed: number[]
  open: number[]
}

/** The peaks of the weekly windows, a row per account: the closed windows and the one still going. */
export function limitAccounts(windows: StatsLimitWindow[]): AccountWindows[] {
  const rows = new Map<string, AccountWindows>()
  for (const { account, peak, open } of windows) {
    const row = rows.get(account) ?? { account, closed: [], open: [] }
    rows.set(account, row)
    ;(open ? row.open : row.closed).push(peak)
  }
  return [...rows.values()]
}
