import type { Notice } from '../../../src/notice/notice.js'
import type { TrackerProject } from '../../../src/tracker/source.js'

/** The pauses before asking a failed list again; after the last one only the service or the tracker coming back asks. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const

export interface Lookup {
  list: TrackerProject[]
  /** The text the list answers; `null` — none asked yet. */
  of: string | null
  failure: Notice | null
  /** The failures in a row of the same text. */
  failures: number
}

export const EMPTY_LOOKUP: Lookup = { list: [], of: null, failure: null, failures: 0 }

/** The pause before the next ask after the given failure in a row (from 1); `null` — no more. */
export function retryDelay(failures: number): number | null {
  return RETRY_DELAYS_MS[failures - 1] ?? null
}

export function answered(list: TrackerProject[], of: string): Lookup {
  return { list, of, failure: null, failures: 0 }
}

/** A failed ask keeps the list shown before: they are only suggestions, and the value they confirmed stays confirmed. */
export function failed(before: Lookup, of: string, failure: Notice): Lookup {
  return { list: before.list, of, failure, failures: before.of === of && before.failure !== null ? before.failures + 1 : 1 }
}

/**
 * How a failed list shows under the fields: an alert only when the typed value cannot be checked without it, else a
 * quiet hint that the suggestions did not load.
 */
export function failureShown(failure: Notice | null, value: string, confirmed: boolean): 'alert' | 'quiet' | null {
  if (failure === null) return null
  return value.trim() !== '' && !confirmed ? 'alert' : 'quiet'
}
