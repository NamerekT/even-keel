import { accountName, accountOf } from '../accountName.js'
import { entrySlot } from '../accounts.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { tokenTag } from '../longToken.js'
import { seriesStyle } from './series.js'

/**
 * The account a session ran on, by its folder key or e-mail: a pill in the account's colour with its name (`accountName`),
 * the key and e-mail in the tip. One no longer listed shows the e-mail's name part. `muted` — a neutral pill, the account's
 * colour only in its dot (a cold chat's card, BTN-1493).
 */
export function AccountTag({ account, agent, muted = false }: { account: string | null | undefined; agent?: string; muted?: boolean }) {
  const { state } = useLive()
  if (account == null) return null
  const view = state?.account
  const entry = accountOf(view, account, agent)
  const at = account.lastIndexOf('@')
  const name = entry === undefined ? (at > 0 ? account.slice(0, at) : account) : accountName(entry, view!.accounts)
  const email = entry?.status?.email
  const tip = entry === undefined ? t.session.account(account) : [t.session.account(entry.key), ...(email == null || email === entry.key ? [] : [t.session.accountEmail(email)]),
    ...(entry.longToken === undefined ? [] : [tokenTag(entry.longToken)])].join('\n')
  return (
    <span className={muted ? 'account-tag account-tag--muted' : 'account-tag'} style={seriesStyle(entry === undefined ? null : entrySlot(view!, entry))} title={tip}>
      <span className="account-tag__name">{name}</span>
    </span>
  )
}
