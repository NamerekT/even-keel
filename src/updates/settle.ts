import type { ActiveChain } from '../chain/model.js'

/**
 * The projects whose chain a restart would cut in a launch, a handover or a closing: a restart between a task's Done
 * and the next launch pauses that chain. A paused chain is not waited for, nor one waiting for the CI of main — that wait
 * is in the state database and survives the restart, and the CI may be the very run that rebuilds this service. Limit
 * holds without a current task or closing are also not waited for when their reset is more than a minute away, or
 * unknown for a model's week. The service checks it before an update; the update process asks `/api/state` before a rebuild.
 */
export function busyChains(active: readonly ActiveChain[], now: Date): string[] {
  return active
    .filter((chain) => {
      if (chain.paused) return false
      const { current } = chain
      if (current === null && chain.ciWait !== undefined && chain.ciWait.local !== true) return false
      if (current === null && chain.closing === undefined) {
        const distant = (until: string) => Date.parse(until) - now.getTime() > 60_000
        if (chain.limitUntil !== undefined && distant(chain.limitUntil)) return false
        if (chain.modelWeek !== undefined && (chain.modelWeek.until === null || distant(chain.modelWeek.until))) return false
      }
      return current === null || current.sessionId === null || current.starting !== undefined || chain.closing !== undefined
    })
    .map((chain) => chain.project)
}
