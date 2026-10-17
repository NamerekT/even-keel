import { useState } from 'react'
import { Link } from 'react-router'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { CLAUDE } from '../../../src/claude/name.js'
import { accountSlot, deviceLogin } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { accountOrder, canWork } from '../state.js'
import { seriesStyle } from '../ui/series.js'
import { agentLabel, AccountName, AccountNotes, LoginSteps, loginHeading, spendText, type Send, type Spend } from './accountParts.js'
import { Limits } from './Limits.js'
import { SwitchWindow } from './SwitchWindow.js'
import { useNow } from './useNow.js'

/** The accounts drawer: a row per account with its limits and exceptions; switching, adding and the details are elsewhere. */
export function AccountPanel({ account, spend, onClose }: { account: AccountView; spend: Spend; onClose: () => void }) {
  const { send, sending, failure } = useCommand()
  const [switching, setSwitching] = useState(false)
  const now = useNow(60_000)
  const { login } = account

  return (
    <aside id="account-panel" className="drawer" role="dialog" aria-label={t.account.title}>
      <div className="drawer__head">
        <h2 className="drawer__title">{t.account.title}</h2>
        <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
          ×
        </button>
      </div>

      <section className="queue__section">
        {account.accounts.length === 0 ? (
          <p className="queue__empty">{t.account.notLoaded}</p>
        ) : (
          <ul className="accounts">
            <li className="accounts__columns" aria-hidden="true">
              <span>{t.limits.fiveHour}</span>
              <span>{t.limits.week}</span>
            </li>
            {accountOrder(account.accounts, now).map((entry) => (
              <AccountItem key={entry.key} entry={entry} view={account} now={now} spend={spend} sending={sending} send={send} />
            ))}
          </ul>
        )}
        <div className="accounts__add">
          <button type="button" className="button" onClick={() => setSwitching(true)}>
            {t.account.switch}
          </button>
          {login === null && (
            <Link to="/accounts/add" className="button">
              + {t.account.add}
            </Link>
          )}
          <Link to="/accounts" className="accounts__all">
            {t.account.all}
          </Link>
        </div>
      </section>

      {login !== null && (
        <section className="queue__section">
          <h2 className="queue__heading">{loginHeading(account)}</h2>
          <LoginSteps login={login} device={deviceLogin(account)} sending={sending} send={send} />
        </section>
      )}

      {failure !== null && <p className="notice notice--error queue__error">{say(failure)}</p>}
      {switching && <SwitchWindow account={account} onClose={() => setSwitching(false)} />}
    </aside>
  )
}

interface ItemProps {
  entry: AccountEntry
  view: AccountView
  now: Date
  spend: Spend
  sending: boolean
  send: Send
}

function AccountItem({ entry, view, now, spend, sending, send }: ItemProps) {
  const email = entry.status?.email ?? null
  const slot = email === null ? null : accountSlot(view, email)

  return (
    <li className={`accounts__item${canWork(entry, now) ? '' : ' accounts__item--off'}`} style={seriesStyle(slot)}>
      <div className="accounts__head">
        <span className="accounts__dot" aria-hidden="true" />
        <AccountName entry={entry} />
        {entry.agent !== CLAUDE && <span className="tag">{agentLabel(entry.agent)}</span>}
      </div>
      {entry.apiKey ? (
        <p className="accounts__note accounts__spend" title={t.account.todayTitle}>
          <span className="tag">{t.account.apiKey}</span>
          {spendText(spend, entry.key)}
        </p>
      ) : (
        <Limits limits={entry.limits} now={now} bare />
      )}
      <AccountNotes entry={entry} view={view} now={now} sending={sending} send={send} />
    </li>
  )
}
