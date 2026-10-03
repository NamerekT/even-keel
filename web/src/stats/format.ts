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

export function weeklyLimit(share: number | null, days: number): { share: number | null; perWeek: boolean } {
  if (days <= 7) return { share, perWeek: false }
  return { share: share === null ? null : (share * 7) / days, perWeek: true }
}
