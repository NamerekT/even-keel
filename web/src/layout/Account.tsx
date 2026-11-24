import { Link } from 'react-router'
import type { AccountView } from '../../../src/account/model.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { CloseIcon } from '../ui/icons.js'
import { type Spend, type Tokens } from './accountParts.js'
import { AccountProblems } from './accountProblems.js'
import { AccountGroups } from './accountRows.js'
import { AccountSettingsEdits } from './accountSettings.js'
import { useOpenAdd } from './AddAccountDialog.js'
import { useNow } from './useNow.js'
import { MachineLabel } from '../ui/MachineLabel.js'
import type { MachineRows } from './machineRows.js'

interface PanelProps {
  account: AccountView
  spend: Spend
  tokens: Tokens
  onClose: () => void
  /** A machine elsewhere's view (BTN-1570): its accounts, its label by the title, no control of the hub's folders. */
  machine?: MachineRows
}

export function AccountPanel({ account, spend, tokens, onClose, machine }: PanelProps) {
  const { send, sending, failure: own } = useCommand()
  const now = useNow(60_000)
  const openAdd = useOpenAdd()
  const props = { view: account, now, spend, tokens, sending, send, machine }
  const failure = machine?.failure ?? own
  // The pick of the place opens on the machine of the view while it is on the link (`defaultPlace`).
  const addOff = machine === undefined ? account.login !== null : machine.addOff
  return <aside id="account-panel" className="drawer account-drawer" role="dialog" aria-label={t.account.title}>
    <div className="drawer__head">
      <h2 className="drawer__title">{t.account.title}{machine !== undefined && <> <MachineLabel id={machine.card.id} name={machine.card.name} color={machine.card.color} /></>}</h2>
      <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}><CloseIcon /></button>
    </div>
    <section className="queue__section">
      <div className="accounts__add">
        <button type="button" className="button" disabled={addOff} onClick={() => { onClose(); openAdd(null) }}>+ {t.account.add}</button>
        <Link to="/accounts" className="button accounts__all" onClick={onClose}>{t.account.all} →</Link>
      </div>
      {machine === undefined && <><AccountProblems view={account} now={now} /><AccountSettingsEdits {...props} /></>}
      {account.accounts.length === 0 ? <p className="queue__empty">{t.account.groupEmpty}</p> : <AccountGroups {...props} />}
    </section>
    {failure !== null && <p className="notice notice--error queue__error">{say(failure)}</p>}
  </aside>
}
