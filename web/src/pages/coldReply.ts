import type { SessionView } from '../../../src/state.js'
import { cacheFreshness } from '../state.js'

/**
 * A reply that would resume a session whose prompt cache went cold (BTN-757): when the cache went cold and how much
 * context the next turn rereads. `null` — the reply goes as usual: the session works (its cache is warm), the cache is
 * warm or about to run out, or it is not known.
 */
export function coldReply(session: Pick<SessionView, 'lamp' | 'cache' | 'contextTokens'>, now: Date): { since: string; tokens: number } | null {
  if (session.lamp === 'working' || session.cache === null) return null
  if (cacheFreshness(session.cache, now).level !== 'cold') return null
  return { since: session.cache.until, tokens: session.contextTokens }
}
