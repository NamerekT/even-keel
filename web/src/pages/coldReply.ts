import type { SessionView } from '../../../src/state.js'
import { cacheFreshness, sessionCache } from '../state.js'

/**
 * A reply that would resume a session whose prompt cache went cold (BTN-757): when the cache went cold and how much
 * context the next turn rereads. `null` — the reply goes as usual: the session works (its cache is warm), the cache is
 * warm or about to run out, or it is not known.
 */
export function coldReply(session: Pick<SessionView, 'lamp' | 'cache' | 'warm' | 'contextTokens'>, now: Date): { since: string; tokens: number } | null {
  const cache = sessionCache(session)
  if (session.lamp === 'working' || cache === null) return null
  if (cacheFreshness(cache, now).level !== 'cold') return null
  return { since: cache.until, tokens: session.contextTokens }
}
