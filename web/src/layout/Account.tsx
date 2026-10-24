import { Link } from 'react-router'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { entrySlot, panelSections, tightestWindow } from '../accounts.js'
import { formatSpan } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { canWork } from '../state.js'
import { seriesStyle } from '../ui/series.js'
import { Tipped } from '../ui/Tipped.js'
import { AccountMark, AccountName, AccountNotes, limitsNote, sharedLimitText, spendsByKey, spendText, staleText, UnknownLimit, type Send, type Spend, type Tokens } from './accountParts.js'
import { AccountRoles } from './AccountRoles.js'
import { useOpenAdd } from './AddAccountDialog.js'
import { FULL_PERCENT, Limits, spanNames, WARM_PERCENT } from './Limits.js'
import { useNow } from './useNow.js'

/**
 * The accounts drawer: first the accounts at work in full — limits, roles, exceptions — then the rest a line each with
 * what is left of its tightest window and "Here" to move a role onto it; adding, the details and a sign-in's steps are elsewhere.
 */
export function AccountPanel({ account, spend, tokens, onClose }: { account: AccountView; spend: Spend; tokens: Tokens; onClose: () => void }) {
  const { send, sending, failure } = useCommand()
  const now = useNow(60_000)
  const { login } = account
  const { working, rest } = panelSections(account, now)
  const openAdd = useOpenAdd()
  const item = (entry: AccountEntry, full: boolean) => (
    <AccountItem key={entry.key} entry={entry} view={account} now={now} spend={spend} tokens={tokens} sending={sending} send={send} full={full} />
  )

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
          <>
            {working.length > 0 && (
              <>
                <h3 className="accounts__part">{t.account.atWork}</h3>
                <ul className="accounts">{working.map((entry) => item(entry, true))}</ul>
              </>
            )}
            {rest.length > 0 && (
              <>
                <h3 className="accounts__part">
                  {t.account.others}
                  <span className="accounts__part-free">{t.account.free}</span>
                </h3>
                <ul className="accounts">{rest.map((entry) => item(entry, false))}</ul>
              </>
            )}
          </>
        )}
        <div className="accounts__add">
          {login === null && (
            <button
              type="button"
              className="button"
              onClick={() => {
                onClose()
                openAdd(null)
              }}
            >
              + {t.account.add}
            </button>
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
  tokens: Tokens
  sending: boolean
  send: Send
  /** An account at work: its limits on a line of their own; the rest give one number in the head. */
  full: boolean
}

function AccountItem({ entry, view, now, spend, tokens, sending, send, full }: ItemProps) {
  return (
    <li className={`accounts__item${canWork(entry, now) ? '' : ' accounts__item--off'}`} style={seriesStyle(entrySlot(view, entry))}>
      <div className="accounts__head">
        <AccountMark entry={entry} now={now} dot />
        <AccountName entry={entry} accounts={view.accounts} whole />
        {!full && <Free entry={entry} now={now} spend={spend} />}
        <AccountRoles entry={entry} view={view} sending={sending} send={send} compact />
      </div>
      {full && <Usage entry={entry} now={now} spend={spend} tokens={tokens} />}
      {full && sharedLimitText(entry, view.accounts) !== null && <p className="accounts__note">{sharedLimitText(entry, view.accounts)}</p>}
      <AccountNotes entry={entry} view={view} now={now} sending={sending} send={send} quiet />
    </li>
  )
}

/** Why an account shows no limits, for the tip of its "no data". */
function noLimitsWhy(entry: AccountEntry): string {
  return limitsNote(entry) ?? staleText(entry) ?? t.account.noLimits
}

/** An account at work: its windows, its spend from a key, what is known of a limit nothing tells, or one grey line with why there is nothing. */
function Usage({ entry, now, spend, tokens }: Pick<ItemProps, 'entry' | 'now' | 'spend' | 'tokens'>) {
  if (spendsByKey(entry)) {
    return (
      <p className="accounts__note" title={t.account.todayTitle}>
        {spendText(spend, entry.key)}
      </p>
    )
  }
  if (limitsNote(entry) !== null) return <UnknownLimit entry={entry} tokens={tokens} now={now} className="accounts__note" why="tip" />
  if (tightestWindow(entry.limits) === null) {
    return (
      <Tipped className="accounts__note accounts__none" tip={noLimitsWhy(entry)} align="start" focusable>
        {t.limits.noData}
      </Tipped>
    )
  }
  return <Limits limits={entry.limits} now={now} bare named />
}

/** What is left of an account's tightest window as one number, its spend from a key, or a dash with why in the tip. */
function Free({ entry, now, spend }: Pick<ItemProps, 'entry' | 'now' | 'spend'>) {
  if (spendsByKey(entry)) {
    return (
      <span className="accounts__free" title={t.account.todayTitle}>
        {spendText(spend, entry.key)}
      </span>
    )
  }
  const tightest = limitsNote(entry) === null ? tightestWindow(entry.limits) : null
  if (tightest === null) {
    return (
      <Tipped className="accounts__free accounts__none" tip={noLimitsWhy(entry)} align="end" focusable>
        —
      </Tipped>
    )
  }
  const used = 100 - tightest.free
  const heat = used >= FULL_PERCENT ? ' accounts__free--full' : used >= WARM_PERCENT ? ' accounts__free--warm' : ''
  const tip = t.account.freeTip(spanNames(tightest.span).title, tightest.free, formatSpan(tightest.window.resetsAt, now))
  return (
    <Tipped className={`accounts__free${heat}`} tip={tip} align="end" focusable>
      {t.limits.short[tightest.span]} {tightest.free}%
    </Tipped>
  )
}
