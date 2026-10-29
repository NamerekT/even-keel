import type { CSSProperties } from 'react'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import type { AccountLevel } from '../../../src/account/header-levels.js'
import { limitSpans, type LimitWindow, type RateLimits } from '../../../src/limits/model.js'
import { entrySlot, tightestWindow } from '../accounts.js'
import { formatSpan, formatTokens } from '../format.js'
import { t } from '../i18n/index.js'
import { accountBadge } from '../state.js'
import { AccountPanel } from './Account.js'
import { spendsByKey, spendText, useSpend, useTokens, type Spend, type Tokens } from './accountParts.js'
import { seriesStyle } from '../ui/series.js'
import { FULL_PERCENT, WARM_PERCENT, windowValue } from './Limits.js'
import { usePopover } from './usePopover.js'
import { CompactLimit } from './accountRows.js'
import { AccountLevels } from './AccountLevels.js'
import './accountLevels.css'
import { OverageChip } from './Overage.js'

interface BlockProps {
  account: AccountView
  limits: RateLimits | null
  now: Date
  levels?: AccountLevel[]
  compact?: boolean
}

/** The server's launch choice in the header; pointing shows its inheritance and pressing opens the accounts drawer. */
export function AccountBlock({ account, now, levels = [{ account: account.active, source: 'shared' }], compact = false }: BlockProps) {
  const { open, setOpen, rootRef } = usePopover()
  const spend = useSpend(account)
  const tokens = useTokens(account)
  const selected = { ...account, active: levels[0]?.account ?? account.active }
  const badge = accountBadge(selected)
  const active = account.accounts.find((entry) => entry.key === selected.active)
  return <div className={`queue-menu account-block${levels.length > 1 ? ' account-block--cascade' : ''}`} ref={rootRef} style={activeStyle(selected)}>
    <button type="button" className="hblock account-block__toggle" aria-expanded={open} aria-controls="account-panel"
      aria-describedby={open || active === undefined ? undefined : 'account-card'} onClick={() => setOpen(!open)}>
      <span className={`account-block__group account-toggle--${badge.kind}`}>
        <AccountName account={selected} />
        <OverageChip entry={active} now={now} plain />
        {levels.length > 1 && <span className="account-stack" aria-label={String(levels.length)}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m2 5 6-3 6 3-6 3Z M2 8l6 3 6-3 M2 11l6 3 6-3" /></svg>{levels.length}
        </span>}
        <BlockLimits entry={active} now={now} spend={spend} tokens={tokens} compact={compact} />
      </span>
    </button>
    {!open && <AccountLevels account={account} levels={levels} now={now} spend={spend} tokens={tokens} />}
    {open && <AccountPanel account={account} spend={spend} tokens={tokens} onClose={() => setOpen(false)} />}
  </div>
}

export function activeStyle(view: AccountView): CSSProperties {
  const active = view.accounts.find((entry) => entry.key === view.active)
  return seriesStyle(active === undefined ? null : entrySlot(view, active))
}

/** The account name and its colour, shared by the header and legend. */
export function AccountName({ account }: { account: AccountView }) {
  const badge = accountBadge(account)
  return <span className={`hblock__seg account-toggle--${badge.kind}`} style={activeStyle(account)}>
    <span className="queue-toggle__dot" aria-hidden="true" /><span className="account-toggle__label">{badge.label}</span>
  </span>
}

function BlockLimits({ entry, now, spend, tokens, compact }: { entry: AccountEntry | undefined; now: Date; spend: Spend; tokens: Tokens; compact: boolean }) {
  if (entry === undefined) return null
  const spans = limitSpans(entry.limits).filter((span) => entry.limits?.[span] != null)
  if (spans.length > 0) {
    const tightest = tightestWindow(entry.limits)
    const shown = compact ? [tightest?.span ?? spans[0]!] : spans
    return shown.map((span) => <LimitSegment key={span} window={entry.limits![span]!} now={now} />)
  }
  const text = spendsByKey(entry) ? spendText(spend, entry.key) : tokens === null ? null : formatTokens(tokens[entry.key]?.day ?? 0)
  return text === null ? null : <span className="hblock__seg limit"><span className="limit__value">{text}</span></span>
}

function LimitSegment({ window, now }: { window: LimitWindow; now: Date }) {
  const percent = Math.round(Math.min(Math.max(window.usedPercentage, 0), 100))
  const heat = percent >= FULL_PERCENT ? ' limit--full' : percent >= WARM_PERCENT ? ' limit--warm' : ''
  return <span className={`hblock__seg limit${heat}`}><Ring percent={percent} /><span className="limit__value">{windowValue(window, percent)}</span>
    <span className="limit__reset">{formatSpan(window.resetsAt, now)}</span></span>
}

export function Ring({ percent }: { percent: number }) {
  const length = 2 * Math.PI * 8
  return <svg className="limit__ring" viewBox="0 0 22 22" width="20" height="20" aria-hidden="true">
    <circle className="limit__track" cx="11" cy="11" r="8" />
    {percent > 0 && <circle className="limit__fill" cx="11" cy="11" r="8" strokeDasharray={`${length * percent / 100} ${length}`} />}
  </svg>
}

/** A single entry in the burger opens the full accounts drawer. */
export function AccountSheet({ account, now }: BlockProps) {
  const { open, setOpen, rootRef } = usePopover()
  const spend = useSpend(account)
  const tokens = useTokens(account)
  const active = account.accounts.find((entry) => entry.key === account.active)
  return <div ref={rootRef}>
    <button type="button" className="gear__item account-sheet-button" aria-expanded={open} aria-controls="account-panel" onClick={() => setOpen(!open)}>
      {t.account.title}<OverageChip entry={active} now={now} plain /><CompactLimit entry={active} now={now} />
      {account.accounts.some((entry) => entry.needsLogin || entry.error !== null) && <span className="account-problem-dot" aria-label={t.account.checkFailedShort} />}
      <span className="sheet__chevron" aria-hidden="true">›</span>
    </button>
    {open && <AccountPanel account={account} spend={spend} tokens={tokens} onClose={() => setOpen(false)} />}
  </div>
}
