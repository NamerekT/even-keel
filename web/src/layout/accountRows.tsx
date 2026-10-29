import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { launchBlock, type AccountEntry, type AccountView } from '../../../src/account/model.js'
import { limitSpans, type LimitSpan } from '../../../src/limits/model.js'
import { accountName, agentLabel } from '../accountName.js'
import { accountGroups, atWork, entrySlot, tightestWindow } from '../accounts.js'
import { formatAgo, formatSpan, formatTokens } from '../format.js'
import { overageTexts, say, t } from '../i18n/index.js'
import { openTab, SHARED_SCOPE } from '../pages/settingsStore.js'
import { Card, Band } from '../ui/blocks.js'
import { seriesStyle } from '../ui/series.js'
import { Tipped } from '../ui/Tipped.js'
import { AccountRowMenu } from './AccountRowMenu.js'
import { AccountWork, rolesOf } from './AccountRoles.js'
import { useOpenAdd } from './AddAccountDialog.js'
import { AccountMark, AccountName, AccountNotes, AgentIcon, limitsNote, NoteActions, planText, sharedLimitText, spendsByKey, spendText, staleText, TransportNote, type Send, type Spend, type Tokens } from './accountParts.js'
import { FULL_PERCENT, spanNames, WARM_PERCENT, windowValue } from './Limits.js'
import { OverageChip, OverageValue, OverageWarning } from './Overage.js'
import './accountRows.css'
import { copilotNote, hasCopilot } from '../../../src/opencode/support.js'

export interface RowsProps {
  view: AccountView
  now: Date
  send: Send
  sending: boolean
  spend: Spend
  tokens: Tokens
  page?: boolean
  fresh?: string[]
}

/** One actionable band, outside the provider rows, for every exception that needs attention. */
export function AccountProblems(props: Pick<RowsProps, 'view' | 'now' | 'send' | 'sending'>) {
  const { view, now, send, sending } = props
  const entries = view.accounts.filter((entry) => entry.needsLogin || entry.error !== null || entry.removing ||
    entry.spendingLimit != null || launchBlock(view, entry.key)?.code === 'account.extraFree' ||
    (entry.loginExpiresAt !== null && new Date(entry.loginExpiresAt).getTime() - now.getTime() < 86_400_000))
  if (entries.length === 0) return null
  return <Band tone="error" className="account-problems">
    {entries.map((entry) => <div className="account-problems__row" key={entry.key}>
      <AgentIcon agent={entry.agent} />
      <div className="account-problems__text"><strong>{accountName(entry, view.accounts)}</strong>
        <AccountNotes entry={entry} view={view} now={now} send={send} sending={sending} bare />
      </div>
      <div className="account-problems__actions">
        <NoteActions entry={entry} view={view} now={now} send={send} sending={sending} />
        {entry.error !== null && !entry.needsLogin && <a className="button button--small" href="/status">{t.account.checkConnection}</a>}
        {launchBlock(view, entry.key)?.code === 'account.extraFree' && <Link className="button button--small" to="/settings" onClick={() => openTab(SHARED_SCOPE, 'models')}>{t.account.manageProviders}</Link>}
      </div>
    </div>)}
  </Band>
}

/** OpenCode and Copilot without a readable allowance share the two token columns. */
export function AccountGroups({ entries, ...props }: RowsProps & { entries?: AccountEntry[] }) {
  const { view, now, page = false } = props
  const openAdd = useOpenAdd()
  const selected = entries ?? view.accounts
  const groups = accountGroups({ ...view, accounts: selected }, now)
  const counted = selected.filter((entry) => limitsNote(entry) !== null)
  const blocks = groups.map((group) => ({ ...group, entries: group.entries.filter((entry) => limitsNote(entry) === null) })).filter((group) => group.entries.length > 0)
  if (counted.length > 0) {
    const ordered = groups.flatMap((group) => group.entries).filter((entry) => counted.includes(entry)).sort((a, b) => Number(atWork(view, b)) - Number(atWork(view, a)))
    blocks.push({ agent: 'tokens', entries: ordered })
  }
  return <div className={page ? 'account-blocks account-blocks--page' : 'account-blocks'}>
    {blocks.map(({ agent, entries: rows }) => {
      const spans = [...new Set(rows.flatMap((entry) => spendsByKey(entry) ? [] : limitSpans(entry.limits)))]
      const tokens = agent === 'tokens'
      const columns = tokens ? [t.account.tokensToday, t.account.tokensMonth] : spans.map((span) => spanNames(span).label)
      return <Card key={agent} className="account-provider" title={<>
        <AgentIcon agent={tokens ? 'opencode' : agent} />
        {tokens ? t.account.tokenProviders : agentLabel(agent)}
        <span className="account-provider__count">{t.account.accountCount(rows.length)}</span>
      </>} actions={page && view.login === null ? <button type="button" className="button button--small"
        onClick={() => openAdd(agent === 'tokens' || !['claude', 'codex', 'opencode', 'copilot'].includes(agent) ? null : agent as 'claude' | 'codex' | 'opencode' | 'copilot')}>+ {t.account.addHere}</button> : undefined}>
        {tokens && <p className="account-provider__note">{t.account.tokensSource}</p>}
        <div className="account-grid account-grid--head" aria-hidden="true" style={{ '--windows': columns.length } as CSSProperties}>
          <span>{t.stats.account}</span>{page && <span>{t.account.usedByLabel}</span>}
          <div className="account-window-heads">{columns.map((label) => <span key={label}>{label}</span>)}</div>
          {page && <><span>{overageTexts().column}</span><span>{t.account.sessionsLabel}</span><span>{t.account.runsThrough}</span></>}
        </div>
        <ul className="account-rows">{rows.map((entry) => <li key={entry.key} style={seriesStyle(entrySlot(view, entry))}>
          <AccountRow entry={entry} {...props} spans={spans} counted={tokens} />
        </li>)}</ul>
      </Card>
    })}
  </div>
}

function AccountRow({ entry, spans, counted, ...props }: RowsProps & { entry: AccountEntry; spans: LimitSpan[]; counted: boolean }) {
  const { view, now, send, sending, spend, tokens, page = false, fresh = [] } = props
  const held = rolesOf(entry, view, send).filter((role) => role.held)
  const plan = planText(entry)
  const shared = sharedLimitText(entry, view.accounts)
  const roles = <div className="account-role-chips">{held.length === 0 ? <span className="account-role account-role--none">{t.account.rolesNone}</span> :
    held.map((role) => <span key={role.label} className={`account-role account-role--${role.label === 'Even Keel' ? 'chain' : 'app'}`}>{role.label}</span>)}</div>
  return <AccountRowMenu entry={entry} view={view} send={send} sending={sending} fresh={fresh.includes(entry.key)}>
    <div className="account-grid" style={{ '--windows': counted ? 2 : spans.length } as CSSProperties}>
      <div className="account-who">
        <div className="account-who__name"><AccountMark entry={entry} now={now} dot /><AccountName entry={entry} accounts={view.accounts} whole={!page} />
          <OverageChip entry={entry} now={now} />
          {shared !== null && <Tipped className="account-shared" tip={shared} align="start" focusable inline>⇄</Tipped>}
          {page && plan !== null && <span className="tag account-plan">{plan}</span>}
        </div>
        {!page && roles}
        {entry.needsLogin && <span className="account-row__error">{entry.apiKey ? t.account.keyRejectedShort : t.account.needsLogin}</span>}
        {!entry.needsLogin && entry.error !== null && <span className="account-row__error">{t.account.checkFailedShort}</span>}
      </div>
      {page && roles}
      <div className="account-windows">
        {counted ? (['day', 'month'] as const).map((span) => <Tipped key={span} className="account-tokens" tip={<>{limitsNote(entry)} · {t.account.tokensTitle}
          {entry.lastLimitAt != null && <span>{t.account.lastLimit(formatAgo(entry.lastLimitAt, now))}</span>}</>} align="start" focusable>
          {tokens === null ? '—' : formatTokens(tokens[entry.key]?.[span] ?? 0)}
        </Tipped>) : spendsByKey(entry) ? <Tipped className="account-spend" tip={t.account.todayTitle} focusable>{spendText(spend, entry.key)}</Tipped> :
          spans.map((span) => <AccountMeter key={span} entry={entry} span={span} now={now} />)}
      </div>
      {page && <><OverageValue entry={entry} now={now} /><div className="account-detail"><AccountWork entry={entry} view={view} /></div><div className="account-detail"><TransportNote entry={entry} brief /></div></>}
      <div className="account-compact"><CompactLimit entry={entry} now={now} /></div>
    </div>
    <OverageWarning entry={entry} view={view} />
    {hasCopilot(entry) && <p className="account-provider__note">{say(copilotNote())}</p>}
  </AccountRowMenu>
}

function AccountMeter({ entry, span, now }: { entry: AccountEntry; span: LimitSpan; now: Date }) {
  const window = entry.limits?.[span] ?? null
  const percent = window === null ? 0 : Math.round(Math.max(0, Math.min(100, window.usedPercentage)))
  const heat = percent >= FULL_PERCENT ? ' account-value--full' : percent >= WARM_PERCENT ? ' account-value--warm' : ''
  const reset = window === null ? '' : formatSpan(window.resetsAt, now)
  const source = entry.limits === null ? '' : t.limits.updated(t.limits.sources[entry.limits.source], formatAgo(entry.limits.updatedAt, now))
  const tip = [window === null ? t.account.noLimits : t.limits.reset(spanNames(span).title, reset, ''), source, staleText(entry), limitsNote(entry)].filter(Boolean).join(' · ')
  return <Tipped className={`account-meter${heat}`} tip={tip} align="start" focusable>
    <span className="account-meter__top"><strong>{window === null ? t.limits.noData : windowValue(window, percent)}</strong>{window !== null && <span>{reset}</span>}</span>
    <span className="account-meter__bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
  </Tipped>
}

export function CompactLimit({ entry, now }: { entry: AccountEntry | undefined; now: Date }) {
  const tightest = entry === undefined || limitsNote(entry) !== null ? null : tightestWindow(entry.limits)
  if (tightest === null) return <span className="account-compact__none">—</span>
  const used = 100 - tightest.free
  const heat = used >= FULL_PERCENT ? ' account-value--full' : used >= WARM_PERCENT ? ' account-value--warm' : ''
  const summary = t.account.freeTip(spanNames(tightest.span).title, tightest.free, formatSpan(tightest.window.resetsAt, now))
  const source = entry?.limits == null ? '' : t.limits.updated(t.limits.sources[entry.limits.source], formatAgo(entry.limits.updatedAt, now))
  return <Tipped inline focusable className={`account-compact__value${heat}`} tip={[summary, source, entry === undefined ? null : staleText(entry)].filter(Boolean).join(' · ')}>{used}%</Tipped>
}
