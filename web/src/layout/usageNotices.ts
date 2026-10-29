import type { AccountView } from '../../../src/account/model.js'
import { accountName } from '../accountName.js'
import { t } from '../i18n/index.js'
import { usageNotice, type UsageNotice } from '../state.js'

export interface AccountUsageNotice extends UsageNotice {
  account: string
  detail: string
}

/** Every account in a shared or project pool, including other providers' entries. */
export function usageNotices(view: AccountView): AccountUsageNotice[] {
  const pooled = new Set(view.pool.map((entry) => entry.account))
  return view.accounts.flatMap((entry) => {
    if (!pooled.has(entry.key) || entry.needsLogin) return []
    const notice = usageNotice(entry.usage)
    return notice === null ? [] : [{
      ...notice,
      account: entry.key,
      text: `${accountName(entry, view.accounts)}: ${t.system.limits} — ${entry.usage.state === 'off' ? t.system.usageOff : t.system.usageUnread}`,
      detail: notice.text,
      key: JSON.stringify([entry.key, notice.key]),
    }]
  })
}
