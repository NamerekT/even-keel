import type { CSSProperties } from 'react'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { limitSpans } from '../../../src/limits/model.js'
import type { EvenKeelState } from '../../../src/state.js'
import { agentLabel } from '../accountName.js'
import { accountGroups, cliMissing, entrySlot, PROVIDERS, type Provider } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { AccountRoles, AccountWork } from '../layout/AccountRoles.js'
import { useFreshAccounts, useOpenAdd } from '../layout/AddAccountDialog.js'
import {
  AccountMark,
  AccountMenu,
  AccountName,
  AgentIcon,
  AccountNotes,
  NoteActions,
  planText,
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
import { Card, PageHead } from '../ui/blocks.js'
import { EvenKeelIcon, PlusIcon } from '../ui/icons.js'
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
  const openAdd = useOpenAdd()
  const fresh = useFreshAccounts(account.accounts.map((entry) => entry.key))

  return (
    <div className="page accounts-page">
      <PageHead title={t.account.title} />

      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}

      {account.accounts.length === 0 ? (
        <p className="queue__empty">{t.account.notLoaded}</p>
      ) : (
        <div className="account-groups">
          {accountGroups(account, now).map(({ agent, entries }) => (
            <Card
              key={agent}
              className="account-group"
              // A section takes the room of its cards, so two small ones share a row instead of leaving its right half empty.
              style={{ '--cards': Math.max(1, entries.length) } as CSSProperties}
              titleId={`account-group-${agent}`}
              title={
                <>
                  <AgentIcon agent={agent} />
                  {agentLabel(agent)}
                </>
              }
              actions={
                // The way is picked in the add dialog; the provider is the section's.
                login === null && isProvider(agent) && !cliMissing(account, agent) ? (
                  <button type="button" className="button button--small" onClick={() => openAdd(agent)}>
                    <PlusIcon />
                    {t.account.addHere}
                  </button>
                ) : undefined
              }
            >
              {entries.length === 0 ? (
                <p className="account-group__empty">{t.account.groupEmpty}</p>
              ) : (
                <ul className="account-cards">
                  {entries.map((entry) => (
                    <AccountCard
                      key={entry.key}
                      entry={entry}
                      view={account}
                      now={now}
                      spend={spend}
                      tokens={tokens}
                      sending={sending}
                      send={send}
                      fresh={fresh.includes(entry.key)}
                    />
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
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
  /** Added by the dialog just now: the card lights up once. */
  fresh: boolean
}

/**
 * Three zones: the head names the account, its plan and whether the chains run on it; the body holds its exceptions,
 * limits, where it works and what runs on it; the foot, level across a row of cards, the frequent actions and ⋯ for
 * the rare ones. The quiet details and the reasons open on pointing.
 */
function AccountCard({ entry, view, now, spend, tokens, sending, send, fresh }: CardProps) {
  const stale = staleText(entry)
  const plan = planText(entry)
  const limits = <Limits limits={entry.limits} now={now} bare />

  return (
    <li
      className={`account-card-item${canWork(entry, now) ? '' : ' accounts__item--off'}${fresh ? ' account-card-item--fresh' : ''}`}
      style={seriesStyle(entrySlot(view, entry))}
    >
      <div className="accounts__head">
        <AccountMark entry={entry} now={now} />
        <AccountName entry={entry} accounts={view.accounts} send={send} sending={sending} />
        {plan !== null && <span className="tag">{plan}</span>}
        {view.active === entry.key && (
          <Tipped className="chip account-card-item__chain" tip={t.account.chainHere} align="end" inline focusable>
            <EvenKeelIcon />
            Even Keel
          </Tipped>
        )}
      </div>
      <AccountNotes entry={entry} view={view} now={now} sending={sending} send={send} bare />
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
      <AccountRoles entry={entry} view={view} sending={sending} send={send} />
      <AccountWork entry={entry} view={view} />
      <TransportNote entry={entry} />
      <div className="account-card-item__foot">
        <NoteActions entry={entry} view={view} now={now} sending={sending} send={send} />
        <AccountMenu entry={entry} view={view} sending={sending} send={send} />
      </div>
    </li>
  )
}
