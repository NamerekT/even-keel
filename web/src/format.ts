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

function pair(major: number, majorUnit: string, minor: number, minorUnit: string): string {
  return minor === 0 ? `${major} ${majorUnit}` : `${major} ${majorUnit} ${minor} ${minorUnit}`
}
