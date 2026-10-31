import { language, localized, t } from './i18n/index.js'
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

/** How long a session has been quiet, coarse: "2 min", "27 min". */
export function formatQuiet(ms: number): string {
  return `${Math.max(1, Math.floor(ms / MINUTE))} ${t.units.minute}`
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

const LINE_TIME = localized((language) => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
const SHORT_DATE = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }))
const FULL_TIME = localized((language) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' }))

/** The time before a line of a feed: "16:05", no seconds and no AM/PM in any language; the full moment is the line's tip. */
export function formatLineTime(at: string): string {
  return LINE_TIME().format(new Date(at))
}

/** When something started, in a list of past things: today's by its time, an earlier day's by a short date. */
export function formatStamp(at: string, now: Date): string {
  const moment = new Date(at)
  return moment.toDateString() === now.toDateString() ? LINE_TIME().format(moment) : SHORT_DATE().format(moment)
}

/** The whole moment with its seconds, for the tip of a short time. */
export function formatFullTime(at: string): string {
  return FULL_TIME().format(new Date(at))
}

/** Which lines of a feed show their time: the first, then each one whose minute differs from the last shown; a line without a time shows none. */
export function minuteMarks(ats: readonly string[]): boolean[] {
  let last = ''
  return ats.map((at) => {
    if (at === '') return false
    const minute = formatLineTime(at) + new Date(at).toDateString()
    if (minute === last) return false
    last = minute
    return true
  })
}

function pair(major: number, majorUnit: string, minor: number, minorUnit: string): string {
  return minor === 0 ? `${major}${majorUnit}` : `${major}${majorUnit} ${minor}${minorUnit}`
}
