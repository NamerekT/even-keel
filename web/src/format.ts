import { localized, t } from './i18n/index.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** `short` packs units against the numbers and shortens the minute: "1ч 33м" for the header. */
export function formatSpan(until: string, now: Date, short = false): string {
  const ms = Date.parse(until) - now.getTime()
  const { day, hour } = t.units
  const minute = short ? t.units.minuteShort : t.units.minute
  const gap = short ? '' : ' '
  if (ms < MINUTE) return `<${gap}1${gap}${minute}`
  if (ms >= DAY) return pair(Math.floor(ms / DAY), day, Math.floor((ms % DAY) / HOUR), hour, gap)
  if (ms >= HOUR) return pair(Math.floor(ms / HOUR), hour, Math.floor((ms % HOUR) / MINUTE), minute, gap)
  return `${Math.floor(ms / MINUTE)}${gap}${minute}`
}

const CLOCK = localized((language) => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }))
const DATED = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))

export function formatMoment(at: string, now: Date): string {
  const moment = new Date(at)
  return moment.toDateString() === now.toDateString() ? CLOCK().format(moment) : DATED().format(moment)
}

export function formatAgo(at: string, now: Date): string {
  const ms = now.getTime() - Date.parse(at)
  const { day, hour, minute, second } = t.units
  if (ms < 5_000) return t.time.justNow
  if (ms < MINUTE) return t.time.ago(`${Math.floor(ms / 1000)} ${second}`)
  if (ms < HOUR) return t.time.ago(`${Math.floor(ms / MINUTE)} ${minute}`)
  if (ms < DAY) return t.time.ago(`${Math.floor(ms / HOUR)} ${hour}`)
  return t.time.ago(`${Math.floor(ms / DAY)} ${day}`)
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
  if (days > 0) return `${days} ${t.units.day} ${hours}:${two(minutes)}:${tail}`
  if (hours > 0) return `${hours}:${two(minutes)}:${tail}`
  return `${minutes}:${tail}`
}

function pair(major: number, majorUnit: string, minor: number, minorUnit: string, gap: string): string {
  return minor === 0 ? `${major}${gap}${majorUnit}` : `${major}${gap}${majorUnit} ${minor}${gap}${minorUnit}`
}
