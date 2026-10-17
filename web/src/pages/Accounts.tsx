import { Link } from 'react-router'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import type { EvenKeelState } from '../../../src/state.js'
import { deviceLogin, entrySlot } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { AccountRoles, AccountWork } from '../layout/AccountRoles.js'
import {
  AccountMark,
  AccountName,
  AccountNotes,
  LoginSteps,
  loginHeading,
  NoteActions,
  RemoveAction,
  spendText,
  staleText,
  useSpend,
  type Send,
  type Spend,
} from '../layout/accountParts.js'
import { Limits } from '../layout/Limits.js'
import { useNow } from '../layout/useNow.js'
import { accountOrder, canWork } from '../state.js'
import { seriesStyle } from '../ui/series.js'
import { Tipped } from '../ui/Tipped.js'
import './accounts.css'

/** Every account folder as a card: whose agent it is, how it signs in, where it works and what runs on it, its limits and details. */
export function AccountsPage({ state }: { state: EvenKeelState }) {
  const { account } = state
  const { send, sending, failure } = useCommand()
  const spend = useSpend(account)
  const now = useNow(60_000)
  const { login } = account

  return (
    <div className="page accounts-page">
      <header className="accounts-page__head">
        <h1 className="page__title">{t.account.title}</h1>
        {login === null && (
          <Link to="/accounts/add" className="button button--primary">
            + {t.account.add}
          </Link>
        )}
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

/** What needs a look or an action stays in sight; the quiet details and the reasons open on pointing. */
function AccountCard({ entry, view, now, spend, sending, send }: CardProps) {
  const stale = staleText(entry)
  const limits = <Limits limits={entry.limits} now={now} bare />

  return (
    <li className={`account-card-item${canWork(entry, now) ? '' : ' accounts__item--off'}`} style={seriesStyle(entrySlot(view, entry))}>
      <div className="accounts__head">
        <AccountMark entry={entry} now={now} />
        <AccountName entry={entry} />
        {entry.status?.subscriptionType != null && <span className="tag">{entry.status.subscriptionType}</span>}
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
          {stale === null ? (
            limits
          ) : (
            <Tipped className="account-card-item__stale" tip={stale} align="start" focusable>
              {limits}
            </Tipped>
          )}
        </>
      )}
      <AccountWork entry={entry} view={view} />
      <AccountNotes entry={entry} view={view} now={now} sending={sending} send={send} bare />
      <div className="account-card-item__foot">
        <RemoveAction entry={entry} view={view} sending={sending} send={send} />
        <NoteActions entry={entry} view={view} now={now} sending={sending} send={send} />
        <AccountRoles entry={entry} view={view} sending={sending} send={send} />
      </div>
    </li>
  )
}
