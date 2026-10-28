import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useFreshAccounts, useOpenAdd } from '../layout/AddAccountDialog.js'
import { useSpend, useTokens } from '../layout/accountParts.js'
import { AccountGroups, AccountProblems } from '../layout/accountRows.js'
import { useNow } from '../layout/useNow.js'
import { EmptyState, PageHead } from '../ui/blocks.js'
import './accounts.css'

export function AccountsPage({ state }: { state: EvenKeelState }) {
  const { account } = state
  const { send, sending, failure } = useCommand()
  const openAdd = useOpenAdd()
  const props = { view: account, send, sending, spend: useSpend(account), tokens: useTokens(account), now: useNow(60_000), fresh: useFreshAccounts(account.accounts.map((entry) => entry.key)) }
  const add = <button type="button" className="button" disabled={account.login !== null} onClick={() => openAdd(null)}>+ {t.account.add}</button>
  return <div className="page accounts-page">
    <PageHead title={t.account.title} actions={account.accounts.length > 0 ? add : undefined} />
    {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    <AccountProblems {...props} />
    {account.accounts.length === 0 ? <EmptyState action={add}>{t.account.groupEmpty}</EmptyState> : <AccountGroups {...props} page />}
  </div>
}
