import { Link } from 'react-router'
import type { AccountView } from '../../../src/account/model.js'
import { panelSections } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { type Spend, type Tokens } from './accountParts.js'
import { AccountGroups, AccountProblems } from './accountRows.js'
import { useOpenAdd } from './AddAccountDialog.js'
import { useNow } from './useNow.js'

export function AccountPanel({ account, spend, tokens, onClose }: { account: AccountView; spend: Spend; tokens: Tokens; onClose: () => void }) {
  const { send, sending, failure } = useCommand()
  const now = useNow(60_000)
  const { working, rest } = panelSections(account, now)
  const openAdd = useOpenAdd()
  const props = { view: account, now, spend, tokens, sending, send }
  return <aside id="account-panel" className="drawer account-drawer" role="dialog" aria-label={t.account.title}>
    <div className="drawer__head">
      <h2 className="drawer__title">{t.account.title}</h2>
      <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>×</button>
    </div>
    <section className="queue__section">
      <div className="accounts__add">
        <button type="button" className="button" disabled={account.login !== null} onClick={() => { onClose(); openAdd(null) }}>+ {t.account.add}</button>
        <Link to="/accounts" className="accounts__all" onClick={onClose}>{t.account.all}</Link>
      </div>
      <AccountProblems {...props} />
      {account.accounts.length === 0 && <p className="queue__empty">{t.account.groupEmpty}</p>}
      {working.length > 0 && <><h3 className="accounts__part">{t.account.atWork}</h3><AccountGroups {...props} entries={working} /></>}
      {rest.length > 0 && <><h3 className="accounts__part">{t.account.others}</h3><AccountGroups {...props} entries={rest} /></>}
    </section>
    {failure !== null && <p className="notice notice--error queue__error">{say(failure)}</p>}
  </aside>
}
