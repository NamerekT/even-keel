import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import type { EvenKeelState, MachineCard } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { useFreshAccounts, useOpenAdd } from '../layout/AddAccountDialog.js'
import { useSpend, useTokens } from '../layout/accountParts.js'
import { accountOfAnchor, AccountProblems, goToAccount } from '../layout/accountProblems.js'
import { AccountGroups } from '../layout/accountRows.js'
import { AccountSettingsEdits } from '../layout/accountSettings.js'
import { useMachineFilter } from '../layout/MachineFilter.js'
import { useNow } from '../layout/useNow.js'
import { EmptyState } from '../ui/blocks.js'
import { AccountsFrame } from './AccountsFrame.js'
import { MachineAccountsPage } from './MachineAccountsPage.js'
import './accounts.css'

export function AccountsPage({ state }: { state: EvenKeelState }) {
  return <AccountsView state={state} card={useMachineFilter().selected} />
}

/**
 * The header's "Accounts" drawer (BTN-1587): the accounts page's own content over the page, for the machine `card` of
 * the view — the hub's accounts for the hub, "All machines" and the own machine, a machine elsewhere's for one.
 */
export function AccountsDrawer({ card, onClose }: { card: MachineCard | null; onClose: () => void }) {
  const { state } = useLive()
  return state === null ? null : <AccountsView state={state} card={card} onClose={onClose} />
}

function AccountsView({ state, card, onClose }: { state: EvenKeelState; card: MachineCard | null; onClose?: () => void }) {
  return card === null || card.own ? <OwnAccounts state={state} onClose={onClose} /> : <MachineAccountsPage card={card} onClose={onClose} />
}

function OwnAccounts({ state, onClose }: { state: EvenKeelState; onClose?: () => void }) {
  const { account } = state
  const { send, sending, failure } = useCommand()
  const openAdd = useOpenAdd()
  const props = { view: account, send, sending, spend: useSpend(account), tokens: useTokens(account), now: useNow(60_000), fresh: useFreshAccounts(account.accounts.map((entry) => entry.key)) }
  const add = <button type="button" className="button" disabled={account.login !== null} onClick={() => { onClose?.(); openAdd(null) }}>+ {t.account.add}</button>
  // The address's `#account-<key>` leads to its row once, as soon as the row is there.
  const { hash } = useLocation()
  const [landing, setLanding] = useState(() => onClose === undefined ? accountOfAnchor(hash) : null)
  const arrived = landing !== null && account.accounts.some((entry) => entry.key === landing)
  useEffect(() => {
    if (!arrived) return
    goToAccount(landing)
    setLanding(null)
  }, [arrived, landing])
  return <AccountsFrame title={t.account.title} actions={account.accounts.length > 0 ? add : undefined} onClose={onClose}>
    {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    <AccountProblems view={account} now={props.now} page />
    <AccountSettingsEdits {...props} />
    {account.accounts.length === 0 ? <EmptyState action={add}>{t.account.groupEmpty}</EmptyState> : <AccountGroups {...props} marketplace={state.packages.marketplace} page />}
  </AccountsFrame>
}
