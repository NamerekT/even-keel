import { fail } from '../notice/notice.js'
import { silentRestart, TURN_HANG_MS, TURN_RESTART_MS, type SilentRestart } from '../sessions/silence.js'
import type { DispatcherDeps } from './model.js'

export function guardRestart(deps: DispatcherDeps, task: string, sessionId: string, confirmed?: SilentRestart): void {
  const since = deps.silentSince?.(task) ?? null
  if (confirmed !== undefined && (confirmed.sessionId !== sessionId || confirmed.since !== since)) throw fail('chain.restartChanged', { task })
  if (!deps.busy(task) || silentRestart(sessionId, since, confirmed, deps.now().getTime())) return
  if (since !== null) {
    throw fail('chain.silentTurn', {
      task, since,
      restartAt: new Date(Date.parse(since) + TURN_RESTART_MS).toISOString(),
      hungAt: new Date(Date.parse(since) + TURN_HANG_MS).toISOString(),
    })
  }
  throw fail('chain.midTurn', { task })
}
