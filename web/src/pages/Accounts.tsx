import { Link } from 'react-router'
import type { EvenKeelState, MachineCard } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useFreshAccounts, useOpenAdd } from '../layout/AddAccountDialog.js'
import { useSpend, useTokens } from '../layout/accountParts.js'
import { AccountGroups, AccountProblems } from '../layout/accountRows.js'
import { AccountSettingsEdits } from '../layout/accountSettings.js'
import { MachineAccountList } from '../layout/MachineAccounts.js'
import { useMachineFilter } from '../layout/MachineFilter.js'
import { useNow } from '../layout/useNow.js'
import { machinePath } from '../machineColor.js'
import { Band, Card, EmptyState, PageHead } from '../ui/blocks.js'
import './accounts.css'

export function AccountsPage({ state }: { state: EvenKeelState }) {
  const picked = useMachineFilter().selected
  return picked === null || picked.own ? <OwnAccounts state={state} /> : <MachineAccounts card={picked} />
}

function OwnAccounts({ state }: { state: EvenKeelState }) {
  const { account } = state
  const { send, sending, failure } = useCommand()
  const openAdd = useOpenAdd()
  const props = { view: account, send, sending, spend: useSpend(account), tokens: useTokens(account), now: useNow(60_000), fresh: useFreshAccounts(account.accounts.map((entry) => entry.key)) }
  const add = <button type="button" className="button" disabled={account.login !== null} onClick={() => openAdd(null)}>+ {t.account.add}</button>
  return <div className="page accounts-page">
    <PageHead title={t.account.title} actions={account.accounts.length > 0 ? add : undefined} />
    {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    <AccountProblems {...props} />
    <AccountSettingsEdits {...props} />
    {account.accounts.length === 0 ? <EmptyState action={add}>{t.account.groupEmpty}</EmptyState> : <AccountGroups {...props} marketplace={state.packages.marketplace} page />}
  </div>
}

/** A machine elsewhere's view (BTN-1279): its accounts and the limits it read; signing in is on its page, adding in "All machines". */
function MachineAccounts({ card }: { card: MachineCard }) {
  const now = useNow(60_000)
  const view = t.machinePanel.view
  const page = <Link to={machinePath(card.id)} className="button">{view.machinePage}</Link>
  return <div className="page accounts-page">
    <PageHead title={t.account.title} actions={page} />
    <Band tone="note">{view.accountsBand(card.name)}</Band>
    {card.accounts.length === 0
      ? <EmptyState action={page}>{view.accountsNone}</EmptyState>
      : <Card title={view.accountsOf(card.name)} titleId="machine-accounts-page"><MachineAccountList card={card} now={now} wide /></Card>}
  </div>
}
