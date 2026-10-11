import { accountSlot } from '../accounts.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { seriesStyle } from './series.js'

/** The account a session ran on: a pill in the account's colour with the e-mail's name part. */
export function AccountTag({ email }: { email: string | null | undefined }) {
  const { state } = useLive()
  if (email == null) return null
  const at = email.lastIndexOf('@')
  return (
    <span className="account-tag" style={seriesStyle(accountSlot(state?.account, email))} title={t.session.account(email)}>
      <span className="account-tag__name">{at > 0 ? email.slice(0, at) : email}</span>
    </span>
  )
}
