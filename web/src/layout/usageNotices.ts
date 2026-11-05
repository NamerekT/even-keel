import type { AccountView } from '../../../src/account/model.js'
import { accountName } from '../accountName.js'
import { t } from '../i18n/index.js'
import { usageNotice, type UsageNotice } from '../state.js'

export interface AccountUsageNotice extends UsageNotice {
  account: string
  /** The account as the page names it. */
  name: string
  /** What is wrong with its limits, without the account: the same for accounts alike. */
  reason: string
  detail: string
}

/** Accounts whose limits are unread alike: one banner (BTN-759). */
export interface UsageGroup {
  tone: UsageNotice['tone']
  reason: string
  notices: AccountUsageNotice[]
}

/** Every account in a shared or project pool, including other providers' entries. */
export function usageNotices(view: AccountView): AccountUsageNotice[] {
  const pooled = new Set(view.pool.map((entry) => entry.account))
  return view.accounts.flatMap((entry) => {
    if (!pooled.has(entry.key) || entry.needsLogin) return []
    const notice = usageNotice(entry.usage)
    if (notice === null) return []
    const name = accountName(entry, view.accounts)
    const reason = `${t.system.limits} — ${entry.usage.state === 'off' ? t.system.usageOff : t.system.usageUnread}`
    return [{
      ...notice,
      account: entry.key,
      name,
      reason,
      text: `${name}: ${reason}`,
      detail: notice.text,
      key: JSON.stringify([entry.key, notice.key]),
    }]
  })
}

/** The notices by tone and reason, in the order of their first account. */
export function usageGroups(notices: AccountUsageNotice[]): UsageGroup[] {
  const groups: UsageGroup[] = []
  for (const notice of notices) {
    const group = groups.find((each) => each.tone === notice.tone && each.reason === notice.reason)
    if (group === undefined) groups.push({ tone: notice.tone, reason: notice.reason, notices: [notice] })
    else group.notices.push(notice)
  }
  return groups
}
