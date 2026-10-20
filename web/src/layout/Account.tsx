import { Link } from 'react-router'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { entrySlot } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { accountOrder, canWork } from '../state.js'
import { seriesStyle } from '../ui/series.js'
import { AccountMark, AccountName, AccountNotes, spendText, type Send, type Spend } from './accountParts.js'
import { AccountRoles } from './AccountRoles.js'
import { Limits, usualSpans } from './Limits.js'
import { useNow } from './useNow.js'

/** The accounts drawer: a row per account with its limits, where it works and its exceptions; adding, the details and a sign-in's steps are elsewhere. */
export function AccountPanel({ account, spend, onClose }: { account: AccountView; spend: Spend; onClose: () => void }) {
  const { send, sending, failure } = useCommand()
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

      {failure !== null && <p className="notice notice--error queue__error">{say(failure)}</p>}
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
  return (
    <li className={`accounts__item${canWork(entry, now) ? '' : ' accounts__item--off'}`} style={seriesStyle(entrySlot(view, entry))}>
      <div className="accounts__head">
        <AccountMark entry={entry} now={now} />
        <AccountName entry={entry} />
      </div>
      {entry.apiKey ? (
        <p className="accounts__note accounts__spend" title={t.account.todayTitle}>
          {spendText(spend, entry.key)}
        </p>
      ) : (
        <Limits limits={entry.limits} now={now} bare named={!usualSpans(entry.limits)} />
      )}
      <AccountRoles entry={entry} view={view} sending={sending} send={send} />
      <AccountNotes entry={entry} view={view} now={now} sending={sending} send={send} />
    </li>
  )
}
