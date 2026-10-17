import { useState } from 'react'
import { Link } from 'react-router'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { APP_LABELS } from '../../../src/account/apps.js'
import type { EvenKeelState } from '../../../src/state.js'
import { accountSlot, connectionOf, deviceLogin } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import {
  agentLabel,
  AccountName,
  AccountNotes,
  globalFolder,
  LoginSteps,
  loginHeading,
  RemoveAction,
  spendText,
  useSpend,
  type Send,
  type Spend,
} from '../layout/accountParts.js'
import { Limits } from '../layout/Limits.js'
import { SwitchWindow } from '../layout/SwitchWindow.js'
import { useNow } from '../layout/useNow.js'
import { accountOrder, canWork, loginLeft } from '../state.js'
import { seriesStyle } from '../ui/series.js'
import './accounts.css'

/** Every account folder as a card: whose agent it is, how it signs in, the roles it holds, its limits and details. */
export function AccountsPage({ state }: { state: EvenKeelState }) {
  const { account } = state
  const { send, sending, failure } = useCommand()
  const [switching, setSwitching] = useState(false)
  const spend = useSpend(account)
  const now = useNow(60_000)
  const { login } = account

  return (
    <div className="page accounts-page">
      <header className="accounts-page__head">
        <h1 className="page__title">{t.account.title}</h1>
        <div className="account__actions">
          <button type="button" className="button" onClick={() => setSwitching(true)}>
            {t.account.switch}
          </button>
          {login === null && (
            <Link to="/accounts/add" className="button button--primary">
              + {t.account.add}
            </Link>
          )}
        </div>
      </header>

      {login !== null && (
        <section className="accounts-page__login">
          <h2 className="queue__heading">{loginHeading(account)}</h2>
          <LoginSteps login={login} device={deviceLogin(account)} sending={sending} send={send} />
        </section>
      )}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}

      {account.accounts.length === 0 ? (
        <p className="queue__empty">{t.account.notLoaded}</p>
      ) : (
        <ul className="account-cards">
          {accountOrder(account.accounts, now).map((entry) => (
            <AccountCard key={entry.key} entry={entry} view={account} now={now} spend={spend} sending={sending} send={send} />
          ))}
        </ul>
      )}
      {switching && <SwitchWindow account={account} onClose={() => setSwitching(false)} />}
    </div>
  )
}

interface CardProps {
  entry: AccountEntry
  view: AccountView
  now: Date
  spend: Spend
  sending: boolean
  send: Send
}

function AccountCard({ entry, view, now, spend, sending, send }: CardProps) {
  const email = entry.status?.email ?? null
  const left = loginLeft(entry.loginExpiresAt, now)
  const roles = [...(entry.key === view.active ? ['Even Keel'] : []), ...view.apps.filter((app) => app.account === entry.key).map((app) => APP_LABELS[app.app])]

  return (
    <li className={`account-card-item${canWork(entry, now) ? '' : ' accounts__item--off'}`} style={seriesStyle(email === null ? null : accountSlot(view, email))}>
      <div className="accounts__head">
        <span className="accounts__dot" aria-hidden="true" />
        <AccountName entry={entry} />
      </div>
      <div className="account-card-item__tags">
        <span className="tag">{agentLabel(entry.agent)}</span>
        <span className="tag">{t.account.connections[connectionOf(entry)]}</span>
        {entry.status?.subscriptionType != null && <span className="tag">{entry.status.subscriptionType}</span>}
        {roles.map((role) => (
          <span key={role} className="tag account-card-item__role" title={t.account.holds(role)}>
            ✓ {role}
          </span>
        ))}
      </div>
      {entry.apiKey ? (
        <p className="accounts__note" title={t.account.todayTitle}>
          {spendText(spend, entry.key)}
        </p>
      ) : (
        <>
          <div className="accounts__columns" aria-hidden="true">
            <span>{t.limits.fiveHour}</span>
            <span>{t.limits.week}</span>
          </div>
          <Limits limits={entry.limits} now={now} bare />
        </>
      )}
      <AccountNotes entry={entry} view={view} now={now} sending={sending} send={send} />
      <div className="accounts__facts">
        {!entry.apiKey && !left.renew && !entry.needsLogin && <span>{t.account.expiry(left.text)}</span>}
        {entry.sessions.length > 0 && <span>{t.account.sessions(entry.sessions.length)}</span>}
        <span>{t.account.folder(entry.global ? globalFolder(entry.agent) : entry.key)}</span>
      </div>
      <RemoveAction entry={entry} view={view} sending={sending} send={send} />
    </li>
  )
}
