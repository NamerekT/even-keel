import { useMemo } from 'react'
import type { AccountView } from '../../../src/account/model.js'
import type { LimitWindow, RateLimits } from '../../../src/limits/model.js'
import { formatAgo, formatMoment, formatSpan } from '../format.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { accountBadge, loginLeft } from '../state.js'
import { loadedData, useStatsAnswer } from '../stats/common.js'
import { AccountPanel, spendText, type Spend } from './Account.js'
import { FULL_PERCENT, WARM_PERCENT } from './Limits.js'
import { usePopover } from './usePopover.js'

const RING_RADIUS = 8
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

interface BlockProps {
  account: AccountView
  limits: RateLimits | null
  now: Date
}

/** Today's spend by account folder from Tally, read only while there is an API account to show it for. */
function useSpend(account: AccountView): Spend {
  const { statsSpend } = useLive()
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const wanted = account.accounts.some((entry) => entry.apiKey)
  return loadedData(useStatsAnswer(wanted ? `spend|${tz}` : null, () => statsSpend(tz)))
}

/**
 * The account and its two limits as one block of the wide header: a click opens the accounts drawer,
 * a hover or focus shows the card with the full numbers. An API account has no limits: today's spend stands for them.
 */
export function AccountBlock({ account, limits, now }: BlockProps) {
  const { open, setOpen, rootRef } = usePopover()
  const badge = accountBadge(account)
  const spend = useSpend(account)
  const active = account.accounts.find((entry) => entry.key === account.active)

  return (
    <div className="queue-menu account-block" ref={rootRef}>
      <button
        type="button"
        className={`hblock account-block__toggle account-toggle--${badge.kind}`}
        aria-expanded={open}
        aria-controls="account-panel"
        aria-describedby={open ? undefined : 'account-card'}
        onClick={() => setOpen(!open)}
      >
        <span className="hblock__seg">
          <span className="queue-toggle__dot" aria-hidden="true" />
          <span className="account-toggle__label">{badge.label}</span>
        </span>
        {active?.apiKey === true ? (
          <span className="hblock__seg limit limit--spend" title={t.account.todayTitle}>
            <span className="limit__value">{spendText(spend, active.key)}</span>
          </span>
        ) : (
          <>
            <LimitSegment window={limits?.fiveHour ?? null} title={t.limits.fiveHourTitle} now={now} />
            <LimitSegment window={limits?.sevenDay ?? null} title={t.limits.weekTitle} now={now} />
          </>
        )}
      </button>
      {!open && <AccountCard account={account} limits={limits} now={now} spend={spend} />}
      {open && <AccountPanel account={account} spend={spend} onClose={() => setOpen(false)} />}
    </div>
  )
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
      <span className="limit__value">{percent}%</span>
      <span className="limit__reset">{formatSpan(window.resetsAt, now, true)}</span>
    </span>
  )
}

function Ring({ percent }: { percent: number }) {
  return (
    <svg className="limit__ring" viewBox="0 0 22 22" width="20" height="20" aria-hidden="true">
      <circle className="limit__track" cx="11" cy="11" r={RING_RADIUS} />
      {percent > 0 && (
        <circle className="limit__fill" cx="11" cy="11" r={RING_RADIUS} strokeDasharray={`${(RING_LENGTH * percent) / 100} ${RING_LENGTH}`} />
      )}
    </svg>
  )
}

/** The same numbers laid out in the narrow screen's sheet: its head opens the accounts drawer. */
export function AccountSheet({ account, limits, now }: BlockProps) {
  const { open, setOpen, rootRef } = usePopover()
  const badge = accountBadge(account)
  const spend = useSpend(account)

  return (
    <div className={`account-card account-card--sheet account-toggle--${badge.kind}`} ref={rootRef}>
      <button type="button" className="account-card__head account-card__open" aria-expanded={open} aria-controls="account-panel" onClick={() => setOpen(!open)}>
        <CardHead account={account} />
        <span className="sheet__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      <CardBody account={account} limits={limits} now={now} spend={spend} />
      {open && <AccountPanel account={account} spend={spend} onClose={() => setOpen(false)} />}
    </div>
  )
}

interface CardProps extends BlockProps {
  spend: Spend
}

function AccountCard({ account, limits, now, spend }: CardProps) {
  return (
    <div id="account-card" className={`account-card account-toggle--${accountBadge(account).kind}`} role="tooltip">
      <div className="account-card__head">
        <CardHead account={account} />
      </div>
      <CardBody account={account} limits={limits} now={now} spend={spend} />
    </div>
  )
}

function CardHead({ account }: { account: AccountView }) {
  const active = account.accounts.find((entry) => entry.key === account.active)
  const plan = active?.apiKey === true ? t.account.apiKey : (active?.status?.subscriptionType ?? null)
  return (
    <>
      <span className="queue-toggle__dot" aria-hidden="true" />
      <span className="account-card__name">{active?.name ?? active?.status?.email ?? accountBadge(account).label}</span>
      {plan !== null && <span className="tag account-card__plan">{plan}</span>}
    </>
  )
}

function CardBody({ account, limits, now, spend }: CardProps) {
  const active = account.accounts.find((entry) => entry.key === account.active)
  if (active?.apiKey === true) {
    return (
      <div className="account-card__foot">
        <span>{spendText(spend, active.key)}</span>
      </div>
    )
  }
  return (
    <>
      <CardWindow label={t.limits.fiveHour} window={limits?.fiveHour ?? null} now={now} />
      <CardWindow label={t.limits.week} window={limits?.sevenDay ?? null} now={now} />
      <div className="account-card__foot">
        <span>{limits === null ? t.limits.noData : t.limits.updated(t.limits.sources[limits.source], formatAgo(limits.updatedAt, now))}</span>
        {active !== undefined && <span>{t.account.expiry(loginLeft(active.loginExpiresAt, now).text)}</span>}
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
      <span className="limit__value">{window === null ? '—' : `${percent}%`}</span>
      <span className="account-card__when">
        {window === null ? t.limits.noData : t.limits.resetAt(formatSpan(window.resetsAt, now), formatMoment(window.resetsAt, now))}
      </span>
    </div>
  )
}
