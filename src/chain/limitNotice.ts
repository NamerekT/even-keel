import { notice, NoticeError, type Notice } from '../notice/notice.js'
import type { ActiveChain, DispatcherDeps } from './model.js'
import type { AccountNow } from './relay.js'

/** Until when the task's account has its limit spent, and the account as the `chain.limitSpent` notice names it. */
export interface LimitSpent {
  until: string
  account?: string
  provider?: string
}

const spentOf = (until: string, account: AccountNow): LimitSpent => {
  const name = account.label ?? account.id ?? undefined
  return { until, ...(name !== undefined && { account: name }), ...(account.provider !== undefined && { provider: account.provider }) }
}

export const limitSpent = (until: string, account: AccountNow): Notice => notice('chain.limitSpent', spentOf(until, account))

/**
 * The spent limit of the task's selected account, including the provider of the task's run; `null` — a window is free.
 * The page holds "New session" on it (BTN-1359), and `requireLimit` refuses one.
 */
export function spentLimit(deps: Pick<DispatcherDeps, 'machine'>, project: string, task: string): LimitSpent | null {
  const until = deps.machine.limitReset(project, task)
  return until === null ? null : spentOf(until, deps.machine.account(project, task))
}

/** Refuse a new session against the task's selected account while its limit is spent. */
export function requireLimit(deps: Pick<DispatcherDeps, 'machine'>, project: string, task: string): void {
  const spent = spentLimit(deps, project, task)
  if (spent !== null) throw new NoticeError(notice('chain.limitSpent', spent))
}

/**
 * Whether the launch of `task` waits for its account's first limits poll (BTN-595). The wait is written into the chain
 * for the page and dropped once the poll answers (BTN-619); `save` runs only when the chain changed.
 */
export function waitsForLimits(deps: Pick<DispatcherDeps, 'machine' | 'log'>, chain: ActiveChain, task: string, save: () => void): boolean {
  const wait = deps.machine.limitsUnread(chain.project, task)
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
