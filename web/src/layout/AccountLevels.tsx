import { useEffect, useRef, useState } from 'react'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import type { AccountLevel } from '../../../src/account/header-levels.js'
import { limitSpans } from '../../../src/limits/model.js'
import { accountName } from '../accountName.js'
import { entrySlot, tightestWindow } from '../accounts.js'
import { InfoIcon } from '../ui/icons.js'
import { rowSlot, type MachineRows } from './machineRows.js'
import { formatAgo, formatSpan, formatTokens } from '../format.js'
import { language, t } from '../i18n/index.js'
import { seriesStyle } from '../ui/series.js'
import { planText, spendsByKey, spendText, useSpend, useTokens, type Spend, type Tokens } from './accountParts.js'
import { FULL_PERCENT, spanNames, WARM_PERCENT, windowValue } from './Limits.js'

function sourceText(source: AccountLevel['source']): string {
  if (source === 'shared') return 'Even Keel'
  if (source === 'project') return language === 'ru' ? 'проект' : 'project'
  return language === 'ru' ? 'задача' : 'task'
}

interface LevelsProps {
  account: AccountView
  levels: AccountLevel[]
  now: Date
  spend: Spend
  tokens: Tokens
  /** A machine elsewhere's view (BTN-1570): a level whose account is not signed in there says so, with "Sign in". */
  machine?: MachineRows
}

export function AccountLevels({ account, levels, now, spend, tokens, machine }: LevelsProps) {
  const first = levels[0]?.account
  const previous = useRef(first)
  const [marked, setMarked] = useState(false)
  useEffect(() => {
    if (previous.current === first) return
    previous.current = first
    setMarked(true)
    const timer = setTimeout(() => setMarked(false), 1600)
    return () => clearTimeout(timer)
  }, [first])
  if (!levels.some((level) => account.accounts.some((entry) => entry.key === level.account))) return null
  const acts = machine !== undefined && levels.some((level) => machine.away.has(level.account))
  // A card with "Sign in" takes the pointer, which the tip-like card otherwise lets through.
  return <div id="account-card" className={`account-card account-levels${acts ? ' account-levels--acts' : ''}`} role="tooltip">
    {levels.map((level, index) => {
      const entry = account.accounts.find((each) => each.key === level.account)
      if (!entry) return null
      const away = machine?.away.get(entry.key)
      const plan = planText(entry)
      const name = accountName(entry, account.accounts)
      const label = entry.name === null && name === entry.status?.email ? name.split('@')[0] : name
      const tightest = tightestWindow(entry.limits)
      const stale = (entry.usage.state === 'stale' || entry.limitsOutdated === true) && entry.limits !== null
      return <div key={level.account} className={`account-level account-level--${index}${index === 0 && marked ? ' account-level--changed' : ''}`} style={seriesStyle(rowSlot(account, entry, machine))}>
        <div className="account-level__head">
          <div className="account-level__identity"><span className="account-card__name">{label}</span>
            {plan && <span className="tag">{plan}</span>}
            <span className="chip account-level__source">{sourceText(level.source)}{level.task && <> <span className="account-level__task">{level.task}</span></>}</span></div>
          {stale && index === 0 && <span className="account-level__stale">{formatAgo(entry.limits!.updatedAt, now)}</span>}
          {index > 0 && away === undefined && (tightest ? <span className="account-level__number">{windowValue(tightest.window, 100 - tightest.free)}</span> : <AccountSummary entry={entry} spend={spend} tokens={tokens} />)}
        </div>
        {away !== undefined && <div className="account-level__away"><InfoIcon /><span className="account-level__away-text">{t.machinePanel.view.notHere}</span>{machine!.signIn(away)}</div>}
        {index === 0 && away === undefined && <div className="account-level__body"><LevelWindows entry={entry} now={now} spend={spend} tokens={tokens} /></div>}
      </div>
    })}
  </div>
}

/** One account as the header's card shows its first level: the name, the plan, the windows or what it spent (the chat's context ring). */
export function AccountCard({ account, entry, now }: { account: AccountView; entry: AccountEntry; now: Date }) {
  const spend = useSpend(account)
  const tokens = useTokens(account)
  const plan = planText(entry)
  const name = accountName(entry, account.accounts)
  const label = entry.name === null && name === entry.status?.email ? name.split('@')[0] : name
  return <div className="account-level account-level--0" style={seriesStyle(entrySlot(account, entry))}>
    <div className="account-level__head">
      <div className="account-level__identity"><span className="account-card__name">{label}</span>{plan && <span className="tag">{plan}</span>}</div>
    </div>
    <div className="account-level__body"><LevelWindows entry={entry} now={now} spend={spend} tokens={tokens} /></div>
  </div>
}

function AccountSummary({ entry, spend, tokens }: { entry: AccountEntry; spend: Spend; tokens: Tokens }) {
  const lines = spendsByKey(entry) ? [spendText(spend, entry.key)] : tokens === undefined ? [t.account.tokensReading] : tokens === null ? [] :
    [t.account.tokensOfDay(formatTokens(tokens[entry.key]?.day ?? 0)), t.account.tokensOfMonth(formatTokens(tokens[entry.key]?.month ?? 0))]
  return lines.length === 0 ? null : <span className="account-level__summary">{lines.map((line) => <span key={line}>{line}</span>)}</span>
}

function LevelWindows({ entry, now, spend, tokens }: { entry: AccountEntry; now: Date; spend: Spend; tokens: Tokens }) {
  const spans = limitSpans(entry.limits).filter((span) => entry.limits?.[span] != null)
  if (spans.length === 0) return <AccountSummary entry={entry} spend={spend} tokens={tokens} />
  return spans.map((span) => {
    const window = entry.limits![span]!
    const percent = Math.round(Math.min(Math.max(window.usedPercentage, 0), 100))
    const heat = entry.limitsOutdated ? ' meter--outdated' : percent >= FULL_PERCENT ? ' meter--full' : percent >= WARM_PERCENT ? ' meter--warm' : ''
    return <div key={span} className={`account-level__window${heat}`}><span className="account-level__label">{spanNames(span).label}</span>
      <span className="meter__bar"><span className="meter__fill" style={{ width: `${percent}%` }} /></span>
      <span className="account-level__value">{windowValue(window, percent)}</span><span className="account-level__reset">{formatSpan(window.resetsAt, now)}</span>
    </div>
  })
}
