import { accountName, accountOf } from '../accountName.js'
import { entrySlot } from '../accounts.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { seriesStyle } from './series.js'

/**
 * The account a session ran on, by its folder key or e-mail: a pill in the account's colour with its name (`accountName`),
 * the key and e-mail in the tip. One no longer listed shows the e-mail's name part.
 */
export function AccountTag({ account }: { account: string | null | undefined }) {
  const { state } = useLive()
  if (account == null) return null
  const view = state?.account
  const entry = accountOf(view, account)
  const at = account.lastIndexOf('@')
  const name = entry === undefined ? (at > 0 ? account.slice(0, at) : account) : accountName(entry, view!.accounts)
  const tip = entry === undefined ? account : [...new Set([entry.key, entry.status?.email ?? entry.key])].join(' · ')
  return (
    <span className="account-tag" style={seriesStyle(entry === undefined ? null : entrySlot(view!, entry))} title={t.session.account(tip)}>
      <span className="account-tag__name">{name}</span>
    </span>
  )
}
