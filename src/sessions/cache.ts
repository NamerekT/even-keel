import { isChatName } from '../chats/model.js'
import { CLAUDE } from '../claude/name.js'
import type { SessionView } from '../state.js'
import { TTL_MS, type CacheTtl } from './transcript.js'

/** How long after its last reply the chain takes a session's cache for warm when its agent does not say: an hour's cache. */
export const WARM_CACHE_MS = 55 * 60_000

/** Each lifetime less a margin for the reply's own seconds and the chain's tick. */
const WARM_MS: Record<CacheTtl, number> = { '5m': 4 * 60_000, '30m': 25 * 60_000, '1h': WARM_CACHE_MS }

/** How long after its last reply a session's cache stays warm, by the lifetime it was written with; unknown — five minutes. */
export function warmCacheMs(ttl: CacheTtl | null): number {
  return WARM_MS[ttl ?? '5m']
}

/**
 * The lifetime the cache trial (`cacheTrial`, BTN-1412) gives a task by its number's second bit, apart from the
 * compaction trial's parity (BTN-505): 0 and 1 mod 4 five minutes, 2 and 3 an hour. `null` — the name has no number.
 */
export function trialTtl(task: string): '5m' | '1h' | null {
  const number = /-(\d+)$/.exec(task)?.[1]
  if (number === undefined) return null
  return Number(number) % 4 < 2 ? '5m' : '1h'
}

/**
 * The session's lifetime is the cache trial's: the trial is on, a Claude chain session (no chat) of a numbered task
 * wrote its cache with its number's variant. Read at every look, so it goes with the trial turned off.
 */
export function byTrial(view: Pick<SessionView, 'task' | 'agent' | 'cache'>, on: boolean): boolean {
  return on && view.agent === CLAUDE && !isChatName(view.task) && view.cache !== null && view.cache.ttl === trialTtl(view.task)
}

/** The longest known lifetime a cache of `ms` outlives, a few seconds of clock drift allowed; shorter than all — five minutes. */
export function ttlWithin(ms: number): CacheTtl {
  const fits = (Object.keys(TTL_MS) as CacheTtl[]).filter((ttl) => TTL_MS[ttl] <= ms + 60_000)
  return fits.reduce<CacheTtl>((longest, ttl) => (TTL_MS[ttl] > TTL_MS[longest] ? ttl : longest), '5m')
}
