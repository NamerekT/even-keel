import type { CSSProperties } from 'react'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { limitSpans, type LimitWindow, type RateLimits } from '../../../src/limits/model.js'
import { accountName } from '../accountName.js'
import { entrySlot } from '../accounts.js'
import { formatAgo, formatMoment, formatSpan } from '../format.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { accountBadge, entryBadge, headerAccounts, loginLeft, projectLabel } from '../state.js'
import { AccountPanel } from './Account.js'
import { limitsNote, sharedLimitText, spendsByKey, spendText, UnknownLimit, useSpend, useTokens, type Spend, type Tokens } from './accountParts.js'
import { seriesStyle } from '../ui/series.js'
import { FULL_PERCENT, spanNames, WARM_PERCENT, windowValue } from './Limits.js'
import { usePopover } from './usePopover.js'

const RING_RADIUS = 8
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

interface BlockProps {
  account: AccountView
  limits: RateLimits | null
  now: Date
}

/**
 * The account and its limits as one block of the wide header: the active one, then every other account a project runs on.
 * A click opens the accounts drawer, a hover or focus shows the card with the full numbers and the projects of each.
 * An API account has no limits: today's spend stands for them.
 */
export function AccountBlock({ account, limits, now }: BlockProps) {
  const { open, setOpen, rootRef } = usePopover()
  const badge = accountBadge(account)
  const spend = useSpend(account)
  const tokens = useTokens(account)
  const active = account.accounts.find((entry) => entry.key === account.active)

  return (
    <div className="queue-menu account-block" ref={rootRef} style={activeStyle(account)}>
      <button
        type="button"
        className="hblock account-block__toggle"
        aria-expanded={open}
        aria-controls="account-panel"
        aria-describedby={open ? undefined : 'account-card'}
        onClick={() => setOpen(!open)}
      >
        {/* A group per account: its kind colours only its own dot, so the groups sit side by side, never one in another. */}
        <span className={`account-block__group account-toggle--${badge.kind}`}>
          <span className="hblock__seg">
            <span className="queue-toggle__dot" aria-hidden="true" />
            <span className="account-toggle__label">{badge.label}</span>
          </span>
          <BlockLimits entry={active} limits={limits} now={now} spend={spend} />
        </span>
        <OtherRings account={account} />
      </button>
      {!open && <AccountCard account={account} limits={limits} now={now} spend={spend} tokens={tokens} />}
      {open && <AccountPanel account={account} spend={spend} tokens={tokens} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** The header's accounts past the active one. */
function others(view: AccountView): AccountEntry[] {
  return headerAccounts(view).filter((entry) => entry.key !== view.active)
}

/** The active account's colour, the same as its card's, for the dot before its name. */
function activeStyle(view: AccountView): CSSProperties {
  const active = view.accounts.find((entry) => entry.key === view.active)
  return seriesStyle(active === undefined ? null : entrySlot(view, active))
}

function BlockLimits({ entry, limits, now, spend }: { entry: AccountEntry | undefined; limits: RateLimits | null; now: Date; spend: Spend }) {
  if (entry !== undefined && spendsByKey(entry)) {
    return (
      <span className="hblock__seg limit limit--spend" title={t.account.todayTitle}>
        <span className="limit__value">{spendText(spend, entry.key)}</span>
      </span>
    )
  }
  const note = entry === undefined ? null : limitsNote(entry)
  if (note !== null) {
    return (
      <span className="hblock__seg limit limit--empty" aria-label={note}>
        <span className="limit__value">—</span>
      </span>
    )
  }
  return limitSpans(limits).map((span) => <LimitSegment key={span} window={limits?.[span] ?? null} title={spanNames(span).title} now={now} />)
}

/**
 * The accounts past the active one as one segment of small rings: each filled to its fullest window, with the account's
 * colour in the middle. Their names, numbers and projects are in the card.
 */
function OtherRings({ account }: { account: AccountView }) {
  const shown = others(account)
  if (shown.length === 0) return null
  return (
    <span className="hblock__seg account-block__others">
      {shown.map((entry) => {
        const window = fullestWindow(entry.limits)
        const percent = window === null ? 0 : percentOf(window)
        return (
          <span
            key={entry.key}
            className={`account-block__mini${window === null ? ' limit--empty' : heatOf(percent)}`}
            style={seriesStyle(entrySlot(account, entry))}
            aria-label={`${entryBadge(entry, account.login, account.accounts).label}${window === null ? '' : ` ${percent}%`}`}
          >
            <Ring percent={percent} />
          </span>
        )
      })}
    </span>
  )
}

function fullestWindow(limits: RateLimits | null): LimitWindow | null {
  const windows = limitSpans(limits).flatMap((span) => limits?.[span] ?? [])
  return windows.reduce<LimitWindow | null>((top, each) => (top === null || each.usedPercentage > top.usedPercentage ? each : top), null)
}

function percentOf(window: LimitWindow): number {
  return Math.round(Math.min(Math.max(window.usedPercentage, 0), 100))
}

function heatOf(percent: number): string {
  return percent >= FULL_PERCENT ? ' limit--full' : percent >= WARM_PERCENT ? ' limit--warm' : ''
}

function LimitSegment({ window, title, now }: { window: LimitWindow | null; title: string; now: Date }) {
  if (window === null) {
    return (
      <span className="hblock__seg limit limit--empty" aria-label={t.limits.empty(title, '')}>
        <Ring percent={0} />
        <span className="limit__value">—</span>
      </span>
    )
  }
  const percent = percentOf(window)
  return (
    <span className={`hblock__seg limit${heatOf(percent)}`}>
      <Ring percent={percent} />
      <span className="limit__value">{windowValue(window, percent)}</span>
      <span className="limit__reset">{formatSpan(window.resetsAt, now)}</span>
    </span>
  )
}

export function Ring({ percent }: { percent: number }) {
  return (
    <svg className="limit__ring" viewBox="0 0 22 22" width="20" height="20" aria-hidden="true">
      <circle className="limit__track" cx="11" cy="11" r={RING_RADIUS} />
      {percent > 0 && (
        <circle className="limit__fill" cx="11" cy="11" r={RING_RADIUS} strokeDasharray={`${(RING_LENGTH * percent) / 100} ${RING_LENGTH}`} />
      )}
      <circle className="limit__core" cx="11" cy="11" r="3" />
    </svg>
  )
}

/** The same numbers laid out in the narrow screen's sheet: its head opens the accounts drawer. */
export function AccountSheet({ account, limits, now }: BlockProps) {
  const { open, setOpen, rootRef } = usePopover()
  const badge = accountBadge(account)
  const spend = useSpend(account)
  const tokens = useTokens(account)
  const active = account.accounts.find((entry) => entry.key === account.active)

  return (
    <div className="account-card account-card--sheet" ref={rootRef} style={activeStyle(account)}>
      <div className={`account-card__part account-toggle--${badge.kind}`}>
        <button type="button" className="account-card__head account-card__open" aria-expanded={open} aria-controls="account-panel" onClick={() => setOpen(!open)}>
          <CardHead entry={active} label={badge.label} accounts={account.accounts} />
          <span className="sheet__chevron" aria-hidden="true">
            ›
          </span>
        </button>
        <CardBody entry={active} limits={limits} now={now} spend={spend} tokens={tokens} />
      </div>
      <OtherParts account={account} now={now} spend={spend} tokens={tokens} />
      {open && <AccountPanel account={account} spend={spend} tokens={tokens} onClose={() => setOpen(false)} />}
    </div>
  )
}

interface CardProps extends BlockProps {
  spend: Spend
  tokens: Tokens
}

function AccountCard({ account, limits, now, spend, tokens }: CardProps) {
  const badge = accountBadge(account)
  const active = account.accounts.find((entry) => entry.key === account.active)
  return (
    <div id="account-card" className="account-card" role="tooltip">
      <div className={`account-card__part account-toggle--${badge.kind}`}>
        <div className="account-card__head">
          <CardHead entry={active} label={badge.label} accounts={account.accounts} />
        </div>
        <CardBody entry={active} limits={limits} now={now} spend={spend} tokens={tokens} />
      </div>
      <OtherParts account={account} now={now} spend={spend} tokens={tokens} />
    </div>
  )
}

/** A part of the card for each account past the active one, in its own colour. */
function OtherParts({ account, now, spend, tokens }: { account: AccountView; now: Date; spend: Spend; tokens: Tokens }) {
  return others(account).map((entry) => {
    const badge = entryBadge(entry, account.login, account.accounts)
    return (
      <div key={entry.key} className={`account-card__part account-toggle--${badge.kind}`} style={seriesStyle(entrySlot(account, entry))}>
        <div className="account-card__head">
          <CardHead entry={entry} label={badge.label} accounts={account.accounts} />
        </div>
        <CardBody entry={entry} limits={entry.limits} now={now} spend={spend} tokens={tokens} />
      </div>
    )
  })
}

function CardHead({ entry, label, accounts }: { entry: AccountEntry | undefined; label: string; accounts: AccountEntry[] }) {
  const plan = entry?.apiKey === true ? t.account.apiKey : (entry?.status?.subscriptionType ?? null)
  return (
    <>
      <span className="queue-toggle__dot" aria-hidden="true" />
      <span className="account-card__name">{entry === undefined ? label : accountName(entry, accounts)}</span>
      {plan !== null && <span className="tag account-card__plan">{plan}</span>}
    </>
  )
}

interface BodyProps {
  entry: AccountEntry | undefined
  limits: RateLimits | null
  now: Date
  spend: Spend
  tokens: Tokens
}

function CardBody({ entry, limits, now, spend, tokens }: BodyProps) {
  const { state } = useLive()
  const projects = entry !== undefined && (
    <p className="account-card__projects">
      {entry.projects.length === 0 ? t.account.projectsNone : t.account.projectsOn(entry.projects.map((project) => projectLabel(state, project)))}
    </p>
  )
  if (entry !== undefined && spendsByKey(entry)) {
    return (
      <>
        {projects}
        <div className="account-card__foot">
          <span>{spendText(spend, entry.key)}</span>
        </div>
      </>
    )
  }
  // OpenCode and Copilot without a window from their provider: why and what is known, not empty rows (BTN-341, BTN-342).
  const unknown = entry !== undefined && limitsNote(entry) !== null
  const shared = entry === undefined ? null : sharedLimitText(entry, state?.account.accounts ?? [])
  return (
    <>
      {projects}
      {unknown ? (
        <UnknownLimit entry={entry} tokens={tokens} now={now} className="account-card__note" why="plain" />
      ) : (
        limitSpans(limits).map((span) => <CardWindow key={span} label={spanNames(span).label} window={limits?.[span] ?? null} now={now} />)
      )}
      {shared !== null && <p className="account-card__note">{shared}</p>}
      <div className="account-card__foot">
        <span>{limits === null ? t.limits.noData : t.limits.updated(t.limits.sources[limits.source], formatAgo(limits.updatedAt, now))}</span>
        {entry !== undefined && <span>{t.account.expiry(loginLeft(entry.loginExpiresAt, now).text)}</span>}
      </div>
    </>
  )
}

function CardWindow({ label, window, now }: { label: string; window: LimitWindow | null; now: Date }) {
  const percent = window === null ? 0 : percentOf(window)
  return (
    <div className={`account-card__window${window === null ? ' limit--empty' : heatOf(percent)}`}>
      <span className="account-card__label">{label}</span>
      <span className="meter__bar">
        <span className="meter__fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="limit__value">{window === null ? '—' : windowValue(window, percent)}</span>
      <span className="account-card__when">
        {window === null ? t.limits.noData : t.limits.resetAt(formatSpan(window.resetsAt, now), formatMoment(window.resetsAt, now))}
      </span>
    </div>
  )
}
