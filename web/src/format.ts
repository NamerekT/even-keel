const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatSpan(until: string, now: Date): string {
  const ms = Date.parse(until) - now.getTime()
  if (ms < MINUTE) return '< 1 мин'
  if (ms >= DAY) return pair(Math.floor(ms / DAY), 'д', Math.floor((ms % DAY) / HOUR), 'ч')
  if (ms >= HOUR) return pair(Math.floor(ms / HOUR), 'ч', Math.floor((ms % HOUR) / MINUTE), 'мин')
  return `${Math.floor(ms / MINUTE)} мин`
}

const CLOCK = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' })
const DATED = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function formatMoment(at: string, now: Date): string {
  const moment = new Date(at)
  return moment.toDateString() === now.toDateString() ? CLOCK.format(moment) : DATED.format(moment)
}

export function formatAgo(at: string, now: Date): string {
  const ms = now.getTime() - Date.parse(at)
  if (ms < 5_000) return 'только что'
  if (ms < MINUTE) return `${Math.floor(ms / 1000)} с назад`
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} мин назад`
  if (ms < DAY) return `${Math.floor(ms / HOUR)} ч назад`
  return `${Math.floor(ms / DAY)} д назад`
}

export function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100
  const units = count % 10
  if (tens >= 11 && tens <= 14) return many
  if (units === 1) return one
  if (units >= 2 && units <= 4) return few
  return many
}

export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  const thousands = Math.round(tokens / 1_000)
  if (thousands < 1_000) return `${thousands}k`
  return `${Number((tokens / 1_000_000).toFixed(1))}M`
}

export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const two = (value: number) => String(value).padStart(2, '0')
  const tail = two(seconds % 60)
  if (days > 0) return `${days} д ${hours}:${two(minutes)}:${tail}`
  if (hours > 0) return `${hours}:${two(minutes)}:${tail}`
  return `${minutes}:${tail}`
}

function pair(major: number, majorUnit: string, minor: number, minorUnit: string): string {
  return minor === 0 ? `${major} ${majorUnit}` : `${major} ${majorUnit} ${minor} ${minorUnit}`
}
