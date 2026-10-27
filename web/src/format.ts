import { language, t } from './i18n/index.js'
import { localMoment } from './moment.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The time left, units against the numbers and the minute short: "1ч 33м", the same in the header and on the cards. */
export function formatSpan(until: string, now: Date): string {
  const ms = Date.parse(until) - now.getTime()
  const { day, hour, minuteShort: minute } = t.units
  if (ms < MINUTE) return `<1${minute}`
  if (ms >= DAY) return pair(Math.floor(ms / DAY), day, Math.floor((ms % DAY) / HOUR), hour)
  if (ms >= HOUR) return pair(Math.floor(ms / HOUR), hour, Math.floor((ms % HOUR) / MINUTE), minute)
  return `${Math.floor(ms / MINUTE)}${minute}`
}

export function formatMoment(at: string, now: Date): string {
  return localMoment(at, now, language)
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

/** A running span short, as the Claude app counts a turn: "23с", "1м 05с", "2ч 03м". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const { hour, minuteShort: minute, second } = t.units
  const two = (value: number) => String(value).padStart(2, '0')
  if (seconds < 60) return `${seconds}${second}`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}${minute} ${two(seconds % 60)}${second}`
  return `${Math.floor(seconds / 3_600)}${hour} ${two(Math.floor((seconds % 3_600) / 60))}${minute}`
}

function pair(major: number, majorUnit: string, minor: number, minorUnit: string): string {
  return minor === 0 ? `${major}${majorUnit}` : `${major}${majorUnit} ${minor}${minorUnit}`
}
