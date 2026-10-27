import { limitSpans, type RateLimits } from './model.js'
import type { UsageHealth } from './usage.js'

const FIRST_WAIT_MS = 15 * 60_000
const LONGEST_WAIT_MS = 4 * 60 * 60_000
const KEPT_HITS = 20

interface Hit {
  at: string
  retryAt: string
  step: number
}

/**
 * When to try an account whose limit nothing tells again (OpenCode Zen, Copilot signed in on the machine; BTN-342): a
 * quarter of an hour after the first hit, the wait doubling up to four hours while each retry hits the limit again, and
 * from the start once the account worked longer than its last wait. Kept in memory: a restart starts over.
 */
export class LimitRetries {
  private readonly hits = new Map<string, Hit[]>()

  /** When to try again after the account hit its limit at `at`; asking about the same hit again gives the same time. */
  retryAfter(key: string, at: string): string {
    const hits = this.hits.get(key) ?? []
    const known = hits.find((hit) => hit.at === at)
    if (known !== undefined) return known.retryAt
    const last = hits.at(-1)
    const time = Date.parse(at)
    if (last !== undefined && time < Date.parse(last.at)) return new Date(time + FIRST_WAIT_MS).toISOString()
    const step = last !== undefined && time <= Date.parse(last.retryAt) + waitOf(last.step) ? last.step + 1 : 0
    const hit = { at, retryAt: new Date(time + waitOf(step)).toISOString(), step }
    this.hits.set(key, [...hits, hit].slice(-KEPT_HITS))
    return hit.retryAt
  }

  /** The latest limit the account hit that the chain asked about; null — none since the start. */
  lastAt(key: string): string | null {
    return this.hits.get(key)?.at(-1)?.at ?? null
  }

  /** A successful session answer or a human continuation starts the retry ladder over. */
  reset(key: string): void {
    this.hits.delete(key)
  }
}

/**
 * A limit nothing tells: no window of it is known and the poll said there is nothing to read (`stale`), not that it has
 * yet to answer. A key account is not asked: its credit or its allowance is waited for instead.
 */
export function noKnownLimit(limits: RateLimits | null, usage: UsageHealth): boolean {
  return usage.state === 'stale' && !limitSpans(limits).some((span) => (limits?.[span] ?? null) !== null)
}

function waitOf(step: number): number {
  return Math.min(FIRST_WAIT_MS * 2 ** step, LONGEST_WAIT_MS)
}
