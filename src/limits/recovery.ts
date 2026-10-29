import type { AccountHome } from '../account/homes.js'
import type { Agent } from '../agent/contract.js'
import { limitResetAfter, type RateLimits } from './model.js'
import { LimitRetries, noKnownLimit } from './retry.js'
import type { UsageHealth } from './usage.js'
import { OVERAGE_LIMIT_TEXT } from './overage.js'

interface RecoveryOptions {
  homeOf: (key: string) => AccountHome | undefined
  agentOf: (home: AccountHome) => Pick<Agent, 'keyUsage'>
  apiKey: (key: string) => boolean
  creditBackAfter: (key: string, at: string, text?: string) => string | null
  limits: (key: string) => RateLimits | null
  usage: (key: string) => UsageHealth
}

/** The account's recovery policy: key credit, a known window, or a growing retry for an unknown limit. */
export function limitRecovery(options: RecoveryOptions) {
  const spendsByKey = (key: string): boolean => {
    const home = options.homeOf(key)
    return options.apiKey(key) && (home === undefined || options.agentOf(home).keyUsage !== true)
  }
  const limitRetries = new LimitRetries()
  const retryAfterLimit = (key: string, at: string, text?: string): string | null => {
    if (spendsByKey(key)) return options.creditBackAfter(key, at, text)
    if (text === OVERAGE_LIMIT_TEXT) return limitResetAfter(options.limits(key), at)
    if (noKnownLimit(options.limits(key), options.usage(key))) return limitRetries.retryAfter(key, at)
    return limitResetAfter(options.limits(key), at)
  }
  return { spendsByKey, limitRetries, retryAfterLimit }
}
