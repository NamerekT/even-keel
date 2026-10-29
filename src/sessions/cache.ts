import { TTL_MS, type CacheTtl } from './transcript.js'

/** How long after its last reply the chain takes a session's cache for warm when its agent does not say: an hour's cache. */
export const WARM_CACHE_MS = 55 * 60_000

/** Each lifetime less a margin for the reply's own seconds and the chain's tick. */
const WARM_MS: Record<CacheTtl, number> = { '5m': 4 * 60_000, '30m': 25 * 60_000, '1h': WARM_CACHE_MS }

/** How long after its last reply a session's cache stays warm, by the lifetime it was written with; unknown — five minutes. */
export function warmCacheMs(ttl: CacheTtl | null): number {
  return WARM_MS[ttl ?? '5m']
}

/** The longest known lifetime a cache of `ms` outlives, a few seconds of clock drift allowed; shorter than all — five minutes. */
export function ttlWithin(ms: number): CacheTtl {
  const fits = (Object.keys(TTL_MS) as CacheTtl[]).filter((ttl) => TTL_MS[ttl] <= ms + 60_000)
  return fits.reduce<CacheTtl>((longest, ttl) => (TTL_MS[ttl] > TTL_MS[longest] ? ttl : longest), '5m')
}
