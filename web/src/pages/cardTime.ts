import { formatDuration } from '../stats/format.js'

/** Over this many estimates the time takes the warning tone: the "Within ×1.5" bound of `/stats`. */
const OVER = 1.5

export interface CardTime {
  estimate: string
  time: string
  over: boolean
}

/** The card's estimate (minutes) and the agent's active time (seconds) as two facts; `null` — neither is known. */
export function cardTimeOf(estimate: number | null | undefined, activeS: number | null | undefined): CardTime | null {
  const minutes = estimate ?? null
  const seconds = activeS ?? null
  if (minutes === null && seconds === null) return null
  return {
    estimate: formatDuration(minutes === null ? null : minutes * 60),
    time: formatDuration(seconds),
    over: minutes !== null && seconds !== null && seconds > minutes * 60 * OVER,
  }
}

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`
const HOURS = String.raw`(?:ч|час(?:а|ов)?|h|hr|hrs|hours?)`
const MINUTES = String.raw`(?:м|мин(?:ут[аы]?)?|m|min|mins|minutes?)`
const ESTIMATE = new RegExp(String.raw`^(?:${NUMBER}\s*${HOURS})?\s*(?:${NUMBER}\s*${MINUTES}?)?$`, 'i')

/**
 * The minutes of an estimate typed on the card (BTN-1288): "20", "1ч 20м", "1,5ч", "2h30m"; a bare number is minutes.
 * `null` — the field is empty, no estimate; `undefined` — it reads as no estimate at all.
 */
export function estimateMinutes(text: string): number | null | undefined {
  const typed = text.trim()
  if (typed === '') return null
  const match = ESTIMATE.exec(typed)
  if (match === null || (match[1] === undefined && match[2] === undefined)) return undefined
  const read = (part: string | undefined) => (part === undefined ? 0 : Number(part.replace(',', '.')))
  const minutes = Math.round(read(match[1]) * 60 + read(match[2]))
  return minutes > 0 ? minutes : undefined
}
