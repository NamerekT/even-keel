import { spendingReset } from './spending.js'

const DAY_MS = 24 * 60 * 60_000
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
// Claude Code: "resets 7:20pm (Europe/Berlin)", "resets Oct 30, 9am (Europe/Berlin)".
const RESET_PATTERN =
  /resets\s+(?:(?<month>[a-z]{3})[a-z]*\.?\s+(?<day>\d{1,2}),?\s+(?:at\s+)?)?(?<hour>\d{1,2})(?::(?<minute>\d{2}))?\s*(?<meridiem>[ap]m)\s*(?:\((?<zone>[^)]+)\))?/i
// Codex, in the zone of the machine it runs on: "try again at 3:46 PM.", "try again at Nov 16th, 2026 10:12 PM.".
const RETRY_PATTERN =
  /try again at\s+(?:(?<month>[a-z]{3})[a-z]*\.?\s+(?<day>\d{1,2})(?:st|nd|rd|th)?,?\s+(?<year>\d{4}),?\s+)?(?<hour>\d{1,2}):(?<minute>\d{2})\s*(?<meridiem>[ap]m)/i

export function resetTimeOf(text: string, at: string): string | null {
  const spending = spendingReset(text, at)
  if (spending !== null) return spending
  const claude = RESET_PATTERN.exec(text)
  const match = (claude ?? RETRY_PATTERN.exec(text))?.groups
  if (match === undefined) return null
  const { month: monthName, day: dayText, year: yearText, hour: hourText, minute: minuteText, meridiem, zone: zoneText } = match
  const zone = zoneText?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone
  const hour = (Number(hourText) % 12) + (meridiem!.toLowerCase() === 'pm' ? 12 : 0)
  const minute = Number(minuteText ?? 0)
  const since = Date.parse(at)
  if (Number.isNaN(since) || hour > 23 || minute > 59) return null

  try {
    const today = wallDate(since, zone)
    if (monthName === undefined) {
      let reset = wallToUtc(today.year, today.month, today.day, hour, minute, zone)
      // Codex names a bare time only for a reset on the same day, rounded down to the minute: one gone by has come already.
      if (reset <= since && claude !== null) reset = wallToUtc(today.year, today.month, today.day + 1, hour, minute, zone)
      return new Date(reset).toISOString()
    }
    const month = MONTHS.indexOf(monthName.toLowerCase())
    if (month < 0) return null
    if (yearText !== undefined) return new Date(wallToUtc(Number(yearText), month, Number(dayText), hour, minute, zone)).toISOString()
    let reset = wallToUtc(today.year, month, Number(dayText), hour, minute, zone)
    if (reset + DAY_MS <= since) reset = wallToUtc(today.year + 1, month, Number(dayText), hour, minute, zone)
    return new Date(reset).toISOString()
  } catch (error) {
    if (error instanceof RangeError) return null
    throw error
  }
}

function wallDate(utc: number, zone: string): { year: number; month: number; day: number } {
  const parts = wallParts(utc, zone)
  return { year: parts.year, month: parts.month - 1, day: parts.day }
}

function wallToUtc(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const guess = Date.UTC(year, month, day, hour, minute)
  const first = guess - zoneOffset(guess, zone)
  return guess - zoneOffset(first, zone)
}

function zoneOffset(utc: number, zone: string): number {
  const parts = wallParts(utc, zone)
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(utc / 1000) * 1000
}

function wallParts(utc: number, zone: string): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number> {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  const value = (type: string) => Number(format.formatToParts(new Date(utc)).find((part) => part.type === type)?.value)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}
