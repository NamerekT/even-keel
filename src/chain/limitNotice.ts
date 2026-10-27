import { fail } from '../notice/notice.js'
import type { DispatcherDeps } from './model.js'

/** Refuse against the task's selected account, including a provider run label. */
export function requireLimit(deps: Pick<DispatcherDeps, 'limitReset' | 'account'>, project: string, task: string): void {
  const until = deps.limitReset(project, task)
  if (until === null) return
  const account = deps.account(project, task)
  throw fail('chain.limitSpent', { until, account: account.label ?? account.id ?? undefined, provider: account.provider })
}
