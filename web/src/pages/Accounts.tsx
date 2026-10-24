import { Link } from 'react-router'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { limitSpans } from '../../../src/limits/model.js'
import type { EvenKeelState } from '../../../src/state.js'
import { agentLabel } from '../accountName.js'
import { accountGroups, canAdd, cliMissing, entrySlot, PROVIDERS, type Provider } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { AccountRoles, AccountWork } from '../layout/AccountRoles.js'
import {
  AccountMark,
  AccountName,
  AgentIcon,
  AccountNotes,
  NoteActions,
  RemoveAction,
  sharedLimitText,
  spendsByKey,
  spendText,
  limitsNote,
  staleText,
  TransportNote,
  UnknownLimit,
  useSpend,
  useTokens,
  type Send,
  type Spend,
  type Tokens,
} from '../layout/accountParts.js'
import { Limits, spanNames } from '../layout/Limits.js'
import { useNow } from '../layout/useNow.js'
import { canWork } from '../state.js'
import { seriesStyle } from '../ui/series.js'
import { Tipped } from '../ui/Tipped.js'
import './accounts.css'

/** Every account folder as a card: whose agent it is, how it signs in, where it works and what runs on it, its limits and details. */
export function AccountsPage({ state }: { state: EvenKeelState }) {
  const { account } = state
  const { send, sending, failure } = useCommand()
  const spend = useSpend(account)
  const tokens = useTokens(account)
  const now = useNow(60_000)
  const { login } = account

  return (
    <div className="page accounts-page">
      <header className="accounts-page__head">
        <h1 className="page__title">{t.account.title}</h1>
      </header>

      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}

      {account.accounts.length === 0 ? (
        <p className="queue__empty">{t.account.notLoaded}</p>
      ) : (
        accountGroups(account, now).map(({ agent, entries }) => (
          <section key={agent} className="account-group" aria-labelledby={`account-group-${agent}`}>
            <header className="account-group__head">
              <h2 id={`account-group-${agent}`} className="account-group__title">
                <AgentIcon agent={agent} />
                {agentLabel(agent)}
              </h2>
              {/* The connection is picked on the add page; the provider is the section's. */}
              {login === null && isProvider(agent) && canAdd(agent) && !cliMissing(account, agent) && (
                <Link to={`/accounts/add?provider=${agent}`} className="button button--small">
                  + {t.account.addHere}
                </Link>
              )}
            </header>
            {entries.length === 0 ? (
              <p className="queue__empty">{t.account.groupEmpty}</p>
            ) : (
              <ul className="account-cards">
                {entries.map((entry) => (
                  <AccountCard key={entry.key} entry={entry} view={account} now={now} spend={spend} tokens={tokens} sending={sending} send={send} />
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  )
}

function isProvider(agent: string): agent is Provider {
  return PROVIDERS.some((each) => each === agent)
}

interface CardProps {
  entry: AccountEntry
  view: AccountView
  now: Date
  spend: Spend
  tokens: Tokens
  sending: boolean
  send: Send
}

/** What needs a look or an action stays in sight; the quiet details and the reasons open on pointing. */
function AccountCard({ entry, view, now, spend, tokens, sending, send }: CardProps) {
  const stale = staleText(entry)
  const limits = <Limits limits={entry.limits} now={now} bare />

  return (
    <li className={`account-card-item${canWork(entry, now) ? '' : ' accounts__item--off'}`} style={seriesStyle(entrySlot(view, entry))}>
      <div className="accounts__head">
        <AccountMark entry={entry} now={now} />
        <AccountName entry={entry} accounts={view.accounts} send={send} sending={sending} />
        {entry.status?.subscriptionType != null && <span className="tag">{entry.status.subscriptionType}</span>}
      </div>
      {limitsNote(entry) !== null ? (
        <UnknownLimit entry={entry} tokens={tokens} now={now} className="accounts__note" why="line" />
      ) : spendsByKey(entry) ? (
        <p className="accounts__note" title={t.account.todayTitle}>
          {spendText(spend, entry.key)}
        </p>
      ) : (
        <>
          <div className="accounts__columns" aria-hidden="true">
            {limitSpans(entry.limits).map((span) => (
              <span key={span}>{spanNames(span).label}</span>
            ))}
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
      {sharedLimitText(entry, view.accounts) !== null && <p className="accounts__note">{sharedLimitText(entry, view.accounts)}</p>}
      <TransportNote entry={entry} />
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
