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
