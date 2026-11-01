import { fail } from '../notice/notice.js'
import type { ActiveChain, DispatcherDeps } from './model.js'

/** Refuse against the task's selected account, including a provider run label. */
export function requireLimit(deps: Pick<DispatcherDeps, 'limitReset' | 'account'>, project: string, task: string): void {
  const until = deps.limitReset(project, task)
  if (until === null) return
  const account = deps.account(project, task)
  throw fail('chain.limitSpent', { until, account: account.label ?? account.id ?? undefined, provider: account.provider })
}

/**
 * Whether the launch of `task` waits for its account's first limits poll (BTN-595). The wait is written into the chain
 * for the page and dropped once the poll answers (BTN-619); `save` runs only when the chain changed.
 */
export function waitsForLimits(deps: Pick<DispatcherDeps, 'limitsUnread' | 'log'>, chain: ActiveChain, task: string, save: () => void): boolean {
  const wait = deps.limitsUnread(chain.project, task)
  if (wait === undefined) {
    if (chain.limitsWait === undefined) return false
    delete chain.limitsWait
    save()
    return false
  }
  if (chain.limitsWait?.account === wait.account && chain.limitsWait.next === wait.next) return true
  if (chain.limitsWait?.account !== wait.account) deps.log(`chain: ${chain.project}: ${task} waits for the first limits poll of ${wait.account}`)
  chain.limitsWait = wait
  save()
  return true
}
