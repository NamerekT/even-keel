import { Fragment } from 'react'
import { Link, useLocation } from 'react-router'
import { launchBlock, type AccountEntry, type AccountView } from '../../../src/account/model.js'
import { loginEndsFrom } from '../account-state.js'
import { accountName, agentLabel } from '../accountName.js'
import { t } from '../i18n/index.js'
import { tokenState } from '../longToken.js'
import { openTab, SHARED_SCOPE } from '../pages/settingsStore.js'
import { Band } from '../ui/blocks.js'
import { stillMotion } from '../ui/landing.js'
import { AccountNotes, NoteActions, signInMixup, type Send } from './accountParts.js'

export type ProblemTone = 'error' | 'warn'

const DAY_MS = 86_400_000
const ANCHOR = 'account-'

/**
 * How bad the account's exceptions are (BTN-1420): an error where its sessions cannot run or run on the wrong account,
 * a warning where they still run but something waits for the user. Null — nothing to show.
 */
export function problemTone(entry: AccountEntry, view: AccountView, now: Date): ProblemTone | null {
  const token = entry.longToken === undefined ? 'fine' : tokenState(entry.longToken, now)
  if (entry.needsLogin || entry.error !== null || entry.usage.reason?.code === 'usage.goKeyExpired' || signInMixup(entry, view.accounts) !== null ||
    token === 'refused' || token === 'over') return 'error'
  // A day before the early end of the sign-in's window: it may end any moment of the window (BTN-1443).
  const ending = entry.loginExpiresAt !== null && Date.parse(loginEndsFrom(entry.loginExpiresAt)) - now.getTime() < DAY_MS
  if (entry.removing || entry.spendingLimit != null || launchBlock(view, entry.key)?.code === 'account.extraFree' || ending || token === 'ending') return 'warn'
  return null
}

/** The row's `id`, the same in the drawer and on `/accounts`, whose address carries it as `#account-<key>`. */
export function accountAnchor(key: string): string {
  return `${ANCHOR}${key}`
}

/** The account key an address's `#account-<key>` names; null for any other hash. */
export function accountOfAnchor(hash: string): string | null {
  let id: string
  try {
    id = decodeURIComponent(hash.replace(/^#/, ''))
  } catch {
    return null
  }
  return id.startsWith(ANCHOR) && id.length > ANCHOR.length ? id.slice(ANCHOR.length) : null
}

/** Scrolls to the account's row, lights it in the colour of its problem and puts the focus on the fix. */
export function goToAccount(key: string): void {
  const row = document.getElementById(accountAnchor(key))
  if (row === null) return
  row.scrollIntoView({ block: 'center', behavior: stillMotion() ? 'auto' : 'smooth' })
  row.classList.remove('account-flash')
  void row.offsetWidth
  row.classList.add('account-flash')
  row.addEventListener('animationend', () => row.classList.remove('account-flash'), { once: true })
  // A fix held by a chain keeps the focus too: its tip says why.
  row.querySelector<HTMLElement>('.account-problem .ui-band__action :is(button, a):not(:disabled)')?.focus({ preventScroll: true })
}

/** The account in the summary: with its agent where an account of another agent bears the same name. */
function summaryName(entry: AccountEntry, accounts: AccountEntry[]): string {
  const name = accountName(entry, accounts)
  const twin = accounts.some((each) => each.agent !== entry.agent && accountName(each, accounts) === name)
  return twin ? `${agentLabel(entry.agent)} › ${name}` : name
}

/**
 * Which accounts have problems, above the agents' cards: one band, red if any of them is an error. It does not say what
 * is wrong — the band under each row does; each name leads there, by the address's anchor on the page (`page`).
 */
export function AccountProblems({ view, now, page = false }: { view: AccountView; now: Date; page?: boolean }) {
  const found = view.accounts.map((entry) => ({ entry, tone: problemTone(entry, view, now) })).filter((each) => each.tone !== null)
  if (found.length === 0) return null
  const words = t.account.problems(found.length)
  const link = (entry: AccountEntry) => {
    const name = summaryName(entry, view.accounts)
    return page ? <AnchorLink anchor={accountAnchor(entry.key)} onClick={() => goToAccount(entry.key)}>{name}</AnchorLink>
      : <button type="button" className="account-problems__name" onClick={() => goToAccount(entry.key)}>{name}</button>
  }
  return <Band tone={found.some((each) => each.tone === 'error') ? 'error' : 'warn'} className="account-problems">
    <span>{words.before}{found.map(({ entry }, index) => <Fragment key={entry.key}>{index > 0 && ', '}{link(entry)}</Fragment>)}{words.after}</span>
  </Band>
}

/** A name leading to its account's row; the page's query, the machine of the view with it, stays (BTN-1575). */
function AnchorLink({ anchor, onClick, children }: { anchor: string; onClick: () => void; children: string }) {
  const { search } = useLocation()
  return <Link className="account-problems__name" to={{ search, hash: anchor }} onClick={onClick}>{children}</Link>
}

interface ProblemProps {
  entry: AccountEntry
  view: AccountView
  now: Date
  send: Send
  sending: boolean
}

/** The account's problems under its row, each with its fix: red for an error, yellow for a warning. */
export function AccountProblem({ entry, view, now, send, sending }: ProblemProps) {
  const tone = problemTone(entry, view, now)
  if (tone === null) return null
  return <Band tone={tone} className="account-problem" action={<>
    <NoteActions entry={entry} view={view} now={now} send={send} sending={sending} />
    {entry.error !== null && !entry.needsLogin && <a className="button button--small" href="/status">{t.account.checkConnection}</a>}
    {launchBlock(view, entry.key)?.code === 'account.extraFree' && <Link className="button button--small" to="/settings" onClick={() => openTab(SHARED_SCOPE, 'models')}>{t.account.manageProviders}</Link>}
  </>}>
    <AccountNotes entry={entry} view={view} now={now} send={send} sending={sending} bare />
  </Band>
}
