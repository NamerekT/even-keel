import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useFreshAccounts, useOpenAdd } from '../layout/AddAccountDialog.js'
import { useSpend, useTokens } from '../layout/accountParts.js'
import { accountOfAnchor, AccountProblems, goToAccount } from '../layout/accountProblems.js'
import { AccountGroups } from '../layout/accountRows.js'
import { AccountSettingsEdits } from '../layout/accountSettings.js'
import { useMachineFilter } from '../layout/MachineFilter.js'
import { useNow } from '../layout/useNow.js'
import { EmptyState, PageHead } from '../ui/blocks.js'
import { MachineAccountsPage } from './MachineAccountsPage.js'
import './accounts.css'

/** The page `/accounts`: the full table of the view's accounts — the hub's, or a machine elsewhere's when one is picked. */
export function AccountsPage({ state }: { state: EvenKeelState }) {
  const picked = useMachineFilter().selected
  return picked === null || picked.own ? <OwnAccounts state={state} /> : <MachineAccountsPage card={picked} />
}

function OwnAccounts({ state }: { state: EvenKeelState }) {
  const { account } = state
  const { send, sending, failure } = useCommand()
  const openAdd = useOpenAdd()
  const props = { view: account, send, sending, spend: useSpend(account), tokens: useTokens(account), now: useNow(60_000), fresh: useFreshAccounts(account.accounts.map((entry) => entry.key)) }
  const add = <button type="button" className="button" disabled={account.login !== null} onClick={() => openAdd(null)}>+ {t.account.add}</button>
  // The address's `#account-<key>` leads to its row once, as soon as the row is there.
  const { hash } = useLocation()
  const [landing, setLanding] = useState(() => accountOfAnchor(hash))
  const arrived = landing !== null && account.accounts.some((entry) => entry.key === landing)
  useEffect(() => {
    if (!arrived) return
    goToAccount(landing)
    setLanding(null)
  }, [arrived, landing])
  return <div className="page accounts-page">
    <PageHead title={t.account.title} actions={account.accounts.length > 0 ? add : undefined} />
    {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    <AccountProblems view={account} now={props.now} page />
    <AccountSettingsEdits {...props} />
    {account.accounts.length === 0 ? <EmptyState action={add}>{t.account.groupEmpty}</EmptyState> : <AccountGroups {...props} marketplace={state.packages.marketplace} page />}
  </div>
}
