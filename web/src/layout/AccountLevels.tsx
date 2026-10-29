import { useEffect, useRef, useState } from 'react'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import type { AccountLevel } from '../../../src/account/header-levels.js'
import { limitSpans } from '../../../src/limits/model.js'
import { accountName } from '../accountName.js'
import { entrySlot, tightestWindow } from '../accounts.js'
import { formatAgo, formatSpan, formatTokens } from '../format.js'
import { language, t } from '../i18n/index.js'
import { seriesStyle } from '../ui/series.js'
import { planText, spendsByKey, spendText, type Spend, type Tokens } from './accountParts.js'
import { FULL_PERCENT, spanNames, WARM_PERCENT, windowValue } from './Limits.js'

function sourceText(source: AccountLevel['source']): string {
  if (source === 'shared') return 'Even Keel'
  if (source === 'project') return language === 'ru' ? 'проект' : 'project'
  return language === 'ru' ? 'задача' : 'task'
}

export function AccountLevels({ account, levels, now, spend, tokens }: { account: AccountView; levels: AccountLevel[]; now: Date; spend: Spend; tokens: Tokens }) {
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
  return <div id="account-card" className="account-card account-levels" role="tooltip">
    {levels.map((level, index) => {
      const entry = account.accounts.find((each) => each.key === level.account)
      if (!entry) return null
      const plan = planText(entry)
      const name = accountName(entry, account.accounts)
      const label = entry.name === null && name === entry.status?.email ? name.split('@')[0] : name
      const tightest = tightestWindow(entry.limits)
      const stale = entry.usage.state === 'stale' && entry.limits !== null
      return <div key={level.account} className={`account-level account-level--${index}${index === 0 && marked ? ' account-level--changed' : ''}`} style={seriesStyle(entrySlot(account, entry))}>
        <div className="account-level__head">
          <div className="account-level__identity"><span className="account-card__name">{label}</span>
            {plan && <span className="tag">{plan}</span>}</div>
          <span className="chip account-level__source">{sourceText(level.source)}{level.task && <> <span className="account-level__task">{level.task}</span></>}</span>
          {stale && index === 0 && <span className="account-level__stale">{formatAgo(entry.limits!.updatedAt, now)}</span>}
          {index > 0 && (tightest ? <span className="account-level__number">{windowValue(tightest.window, 100 - tightest.free)}</span> : <AccountSummary entry={entry} spend={spend} tokens={tokens} />)}
        </div>
        {index === 0 && <div className="account-level__body"><LevelWindows entry={entry} now={now} spend={spend} tokens={tokens} /></div>}
      </div>
    })}
  </div>
}

function AccountSummary({ entry, spend, tokens }: { entry: AccountEntry; spend: Spend; tokens: Tokens }) {
  const text = spendsByKey(entry) ? spendText(spend, entry.key) : tokens === null ? null : t.account.tokens(formatTokens(tokens[entry.key]?.day ?? 0), formatTokens(tokens[entry.key]?.month ?? 0))
  return text === null ? null : <span className="account-level__summary">{text}</span>
}

function LevelWindows({ entry, now, spend, tokens }: { entry: AccountEntry; now: Date; spend: Spend; tokens: Tokens }) {
  const spans = limitSpans(entry.limits).filter((span) => entry.limits?.[span] != null)
  if (spans.length === 0) return <AccountSummary entry={entry} spend={spend} tokens={tokens} />
  return spans.map((span) => {
    const window = entry.limits![span]!
    const percent = Math.round(Math.min(Math.max(window.usedPercentage, 0), 100))
    const heat = percent >= FULL_PERCENT ? ' meter--full' : percent >= WARM_PERCENT ? ' meter--warm' : ''
    return <div key={span} className={`account-level__window${heat}`}><span className="account-level__label">{spanNames(span).label}</span>
      <span className="meter__bar"><span className="meter__fill" style={{ width: `${percent}%` }} /></span>
      <span className="account-level__value">{windowValue(window, percent)}</span><span className="account-level__reset">{formatSpan(window.resetsAt, now)}</span>
    </div>
  })
}
