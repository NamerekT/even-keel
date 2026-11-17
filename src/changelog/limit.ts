import type { RateLimits } from '../limits/model.js'

export type SpentWindow = 'fiveHour' | 'sevenDay' | 'month'

/** A spent limit of the account a changelog draft is written on: its window and reset, each where known. */
export interface SpentLimit {
  window?: SpentWindow
  until?: string
}

const WINDOWS: readonly SpentWindow[] = ['fiveHour', 'sevenDay', 'month']

/**
 * The account's window used up as of its last known limits, so a paid draft turn is not sent only to be refused: the
 * one that resets last, as the account waits for it. A window whose reset has already come counts as free.
 */
export function spentLimitOf(limits: RateLimits | null, now: Date): SpentLimit | null {
  if (limits === null) return null
  const spent = WINDOWS.flatMap((window) => {
    const each = limits[window]
    return each !== null && each !== undefined && each.usedPercentage >= 100 && Date.parse(each.resetsAt) > now.getTime() ? [{ window, until: each.resetsAt }] : []
  })
  return spent.sort((a, b) => Date.parse(a.until) - Date.parse(b.until)).at(-1) ?? null
}

const REFUSAL = /usage_limit_reached|"api_error_status"\s*:\s*429|hit your [\w -]*limit|usage limit/i
const WINDOW_WORDS: ReadonlyArray<[RegExp, SpentWindow]> = [
  [/5-hour|five-hour/i, 'fiveHour'],
  [/weekly|7-day|seven-day/i, 'sevenDay'],
  [/monthly/i, 'month'],
]

/**
 * Whether the error of a one-turn write is the CLI's refusal on a spent limit (a 429, `usage_limit_reached`, "hit your
 * … limit"), with the window its text names; `null` — some other failure.
 */
export function limitRefusalIn(text: string): SpentLimit | null {
  if (!REFUSAL.test(text)) return null
  const window = WINDOW_WORDS.find(([words]) => words.test(text))?.[1]
  return window === undefined ? {} : { window }
}
