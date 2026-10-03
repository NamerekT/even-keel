import type { LimitCoverage, StatsLimitWindow } from '../../../src/stats/model.js'
import { dayCount, type DayRange } from './period.js'

const REASONS: Record<string, string> = {
  unclear_task: 'неясная задача',
  broken_tooling: 'сломанный инструмент',
  debug_loop: 'отладка по кругу',
  waiting_user: 'ждала пользователя',
  limit_env: 'лимит или окружение',
  normal: 'норма',
  other: 'другое',
}

const KINDS: Record<string, string> = {
  failures: 'падения подряд',
  denied: 'отказ в разрешении',
  repeat: 'повтор команды',
  reread: 'перечитывание файла',
  no_commit: 'без коммита',
  rewind: 'откат',
  compact: 'сжатие контекста',
  handoff: 'после передачи дел',
}

const MODELS: Record<string, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
  other: 'другие',
}

const ENTRYPOINTS: Record<string, string> = {
  baton: 'Батон',
  vscode: 'VS Code',
  desktop: 'приложение',
  cli: 'CLI',
  'tally-classify': 'Tally',
  other: 'другое',
}

const LAUNCHES: Record<string, string> = {
  launch: 'запуск',
  start: 'запуск',
  resume: 'продолжение',
  relay: 'передача по лимиту',
  restart: 'новая сессия',
  checkpoint: 'контрольная точка',
}

const GROUPED = new Intl.NumberFormat('ru', { maximumFractionDigits: 0 })

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0'
  if (amount < 0.01) return '< $0.01'
  if (amount < 100) return `$${amount.toFixed(2)}`
  return `$${GROUPED.format(amount).replace(/\s/g, ' ')}`
}

export function costChange(cost: number, previous: number): string | null {
  if (previous <= 0) return null
  const percent = Math.round(((cost - previous) / previous) * 100)
  if (percent === 0) return '±0 %'
  return percent > 0 ? `+${percent} %` : `−${-percent} %`
}

export function formatShare(share: number | null): string {
  if (share === null) return '—'
  if (share === 0) return '0 %'
  if (share < 1) return '< 1 %'
  return `${Math.round(share)} %`
}

export function reasonLabel(reason: string | null): string {
  if (reason === null) return 'не разобрано'
  return REASONS[reason] ?? reason
}

export function kindLabel(kind: string): string {
  return KINDS[kind] ?? kind
}

export function launchLabel(reason: string | null): string {
  if (reason === null) return 'вне цепочки'
  return LAUNCHES[reason] ?? reason
}

export function modelLabel(model: string): string {
  return MODELS[model] ?? model
}

export function entrypointLabel(entrypoint: string): string {
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

export function limitWindows(windows: StatsLimitWindow[]): string | null {
  if (windows.length === 0) return null
  const accounts = [...new Set(windows.map((each) => each.account))]
  const peaks = (account: string) =>
    windows
      .filter((each) => each.account === account)
      .map((each) => `${formatShare(each.peak)}${each.open ? ' идёт' : ''}`.replaceAll(' ', ' '))
      .join(', ')
  if (accounts.length === 1) return `окна: ${peaks(accounts[0]!)}`
  return `окна: ${accounts.map((account) => `${account} ${peaks(account)}`).join(' · ')}`
}
