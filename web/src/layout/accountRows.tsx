import { Link } from 'react-router'
import type { PackagesView } from '../../../src/state.js'
import { launchBlock, type AccountEntry, type AccountView } from '../../../src/account/model.js'
import { limitSpans, type LimitSpan, type LimitWindow, type ModelWeek } from '../../../src/limits/model.js'
import { OPENCODE } from '../../../src/opencode/name.js'
import { accountName, agentLabel } from '../accountName.js'
import { ACCESS_OWNER, accessGroups, accessOf, accountGroups, entrySlot, PROVIDERS, tightestWindow, type Access, type Provider } from '../accounts.js'
import { formatAgo, formatSpan, formatTokens } from '../format.js'
import { overageTexts, say, t } from '../i18n/index.js'
import { openTab, SHARED_SCOPE } from '../pages/settingsStore.js'
import { formatUsd } from '../stats/format.js'
import { Card, Band } from '../ui/blocks.js'
import { seriesStyle } from '../ui/series.js'
import { Tipped } from '../ui/Tipped.js'
import { AccountRowMenu } from './AccountRowMenu.js'
import { AccountMarketplace } from './AccountMarketplace.js'
import { AccountWork, rolesOf } from './AccountRoles.js'
import { useOpenAdd } from './AddAccountDialog.js'
import { AccountMark, AccountName, AccountNotes, AgentIcon, limitsNote, NoteActions, planText, sharedLimitText, signInMixup, spendsByKey, staleText, TransportNote, type Send, type Spend, type Tokens } from './accountParts.js'
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
  marketplace?: PackagesView['marketplace']
}

/** One actionable band, outside the provider rows, for every exception that needs attention. */
export function AccountProblems(props: Pick<RowsProps, 'view' | 'now' | 'send' | 'sending'>) {
  const { view, now, send, sending } = props
  const entries = view.accounts.filter((entry) => entry.needsLogin || entry.error !== null || entry.removing ||
    entry.spendingLimit != null || launchBlock(view, entry.key)?.code === 'account.extraFree' || signInMixup(entry, view.accounts) !== null ||
    (entry.loginExpiresAt !== null && new Date(entry.loginExpiresAt).getTime() - now.getTime() < 86_400_000))
  if (entries.length === 0) return null
  return <Band tone="error" className="account-problems">
    {entries.map((entry) => <div className="account-problems__row" key={entry.key}>
      <AgentIcon agent={entry.agent} />
      <div className="account-problems__text"><strong>{[agentLabel(entry.agent), accessLabel(accessOf(entry), entry.agent), accountName(entry, view.accounts)].join(' › ')}</strong>
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

/** The name of a connection group; Copilot inside OpenCode's block says which GitHub product it is. */
export function accessLabel(access: Access, agent: string): string {
  return access === 'github' && agent === OPENCODE ? t.account.agents.copilot : t.account.access[access]
}

/** What a connection group's rows show under its head: windows, each named in its row, or two sums, of dollars or of tokens. */
type Measure = 'limits' | 'spend' | 'tokens'

function measureOf(rows: AccountEntry[]): Measure {
  if (rows.every(spendsByKey)) return 'spend'
  return rows.every((entry) => limitsNote(entry) !== null) ? 'tokens' : 'limits'
}

/** A card per agent and inside it a block per connection, its stripe in the colour of who bills it (BTN-576). */
export function AccountGroups({ entries, ...props }: RowsProps & { entries?: AccountEntry[] }) {
  const { view, now, page = false, marketplace } = props
  const openAdd = useOpenAdd()
  const groups = accountGroups({ ...view, accounts: entries ?? view.accounts }, now)
  return <div className={page ? 'account-blocks account-blocks--page' : 'account-blocks'}>
    {groups.map(({ agent, entries: rows }) => <Card key={agent} className="account-provider" title={<>
      <span className="account-provider__icon"><AgentIcon agent={agent} /></span>
      {agentLabel(agent)}
      <span className="account-provider__count">{t.account.accountCount(rows.length)}</span>
    </>} actions={page ? <>
      {agent === 'claude' && marketplace != null && <AccountMarketplace marketplace={marketplace} send={props.send} sending={props.sending} />}
      {view.login === null && (PROVIDERS as readonly string[]).includes(agent) && <button type="button" className="button button--small"
        onClick={() => openAdd(agent as Provider)}>+ {t.account.addHere}</button>}
    </> : undefined}>
      {accessGroups(rows).map(({ access, entries: members }) => <AccessBlock key={access} agent={agent} access={access} rows={members} {...props} />)}
    </Card>)}
  </div>
}

function AccessBlock({ agent, access, rows, ...props }: RowsProps & { agent: string; access: Access; rows: AccountEntry[] }) {
  const { view, page = false } = props
  const measure = measureOf(rows)
  const owner = ACCESS_OWNER[access]
  const columns = measure === 'limits' ? [t.account.limitsLabel] : [t.account.tokensToday, t.account.tokensMonth]
  return <section className={owner === null ? 'account-access' : `account-access account-access--${owner}`} aria-label={accessLabel(access, agent)}>
    <div className="account-grid account-grid--head">
      <span className="account-access__title">{accessLabel(access, agent)} <span className="account-access__count">{rows.length}</span>
        {measure === 'tokens' && <span className="account-access__count"> · {t.account.tokensSource}</span>}</span>
      {page && <span aria-hidden="true">{t.account.usedByLabel}</span>}
      <div className={`account-window-heads account-window-heads--${columns.length}`} aria-hidden="true">{columns.map((label) => <span key={label}>{label}</span>)}</div>
      {page && <><span aria-hidden="true">{overageTexts().column}</span><span aria-hidden="true">{t.account.sessionsLabel}</span><span aria-hidden="true">{t.account.runsThrough}</span></>}
    </div>
    <ul className="account-rows">{rows.map((entry) => <li key={entry.key} style={seriesStyle(entrySlot(view, entry))}>
      <AccountRow entry={entry} access={access} named={measure === 'limits'} {...props} />
    </li>)}</ul>
  </section>
}

/** `named` — the head says only "Limits", so each value in the row names its window or period itself. */
function AccountRow({ entry, access, named, ...props }: RowsProps & { entry: AccountEntry; access: Access; named: boolean }) {
  const { view, now, send, sending, spend, tokens, page = false, fresh = [] } = props
  const held = rolesOf(entry, view, send).filter((role) => role.held)
  const plan = planText(entry)
  const shared = sharedLimitText(entry, view.accounts)
  const mixup = signInMixup(entry, view.accounts)
  const unsupported = access === 'github' && hasCopilot(entry)
  const roles = <div className="account-role-chips">{held.length === 0 ? <span className="account-role account-role--none">{unsupported ? t.account.notSupported : t.account.rolesNone}</span> :
    held.map((role) => <span key={role.label} className={`account-role account-role--${role.label === 'Even Keel' ? 'chain' : 'app'}`}>{role.label}</span>)}</div>
  const counted = limitsNote(entry) !== null
  const sums = spendsByKey(entry) ? spend?.[entry.key] ?? null : tokens?.[entry.key] ?? null
  const tip = entry.cloud !== undefined ? t.account.cloudSpendTitle : spendsByKey(entry) ? t.account.spendTitle : <>{limitsNote(entry)} · {t.account.tokensTitle}
    {entry.lastLimitAt != null && <span>{t.account.lastLimit(formatAgo(entry.lastLimitAt, now))}</span>}</>
  const loaded = spendsByKey(entry) ? spend !== null : tokens !== null
  return <AccountRowMenu entry={entry} view={view} send={send} sending={sending} fresh={fresh.includes(entry.key)}>
    <div className="account-grid">
      <div className="account-who">
        <div className="account-who__name"><AccountMark entry={entry} now={now} dot /><AccountName entry={entry} accounts={view.accounts} whole={!page} />
          <OverageChip entry={entry} now={now} />
          {shared !== null && <Tipped className="account-shared" tip={shared} align="start" focusable inline>⇄</Tipped>}
          {plan !== null && !entry.apiKey && entry.agent !== OPENCODE && <span className="tag account-plan">{plan}</span>}
        </div>
        {!page && roles}
        {entry.needsLogin && <span className="account-row__error">{entry.apiKey ? t.account.keyRejectedShort : entry.cloud !== undefined ? t.account.checkFailedShort : t.account.needsLogin}</span>}
        {!entry.needsLogin && entry.error !== null && <span className="account-row__error">{t.account.checkFailedShort}</span>}
        {entry.status?.loggedIn === null && <span className="account-row__error account-row__unknown">{t.account.authUnknown}</span>}
        {mixup !== null && <span className="account-row__error">{mixup.short}</span>}
        {outdatedText(entry, now) !== null && <span className="account-row__outdated">{outdatedText(entry, now)}</span>}
      </div>
      {page && roles}
      <div className="account-windows">
        {spendsByKey(entry) || counted ? <>
          {(['day', 'month'] as const).map((period) => <Tipped key={period} className="account-sum" tip={tip} align="start" focusable>
            {named && <span className="account-meter__name">{period === 'day' ? t.account.tokensToday : t.account.tokensMonth}</span>}
            <strong>{!loaded ? '—' : spendsByKey(entry) ? formatUsd(sums?.[period] ?? 0) : formatTokens(sums?.[period] ?? 0)}</strong>
          </Tipped>)}
          {spendsByKey(entry) && entry.keyLimit !== undefined && <KeyLeft entry={entry} now={now} />}
        </> : <>
          {limitSpans(entry.limits).map((span) => <AccountMeter key={span} entry={entry} span={span} now={now} />)}
          {entry.limits?.models?.weeks.map((week) => <ModelMeter key={`model:${week.model}`} entry={entry} week={week} now={now} />)}
        </>}
      </div>
      {page && <><OverageValue entry={entry} now={now} /><div className="account-detail"><AccountWork entry={entry} view={view} /></div><div className="account-detail"><TransportNote entry={entry} brief /></div></>}
      <div className="account-compact"><CompactLimit entry={entry} now={now} /></div>
    </div>
    <OverageWarning entry={entry} view={view} />
    {hasCopilot(entry) && !(unsupported && held.length === 0) && <p className="account-provider__note">{say(copilotNote())}</p>}
  </AccountRowMenu>
}

/**
 * What is left of the limit set on the key itself, after the key's spend (an OpenRouter key, BTN-847). Named always:
 * the group's head names only the spend's columns.
 */
function KeyLeft({ entry, now }: { entry: AccountEntry; now: Date }) {
  const { remaining, limit, reset, at } = entry.keyLimit!
  const used = limit > 0 ? (1 - remaining / limit) * 100 : 100
  const heat = remaining <= 0 || used >= FULL_PERCENT ? ' account-value--full' : used >= WARM_PERCENT ? ' account-value--warm' : ''
  const tip = t.account.keyLimitTitle(formatUsd(remaining), formatUsd(limit), t.account.keyLimitResets[reset ?? 'never'], formatAgo(at, now))
  return <Tipped className={`account-sum${heat}`} tip={tip} align="start" focusable>
    <span className="account-meter__name">{t.account.keyLeft}</span>
    <strong>{formatUsd(remaining)}</strong>
  </Tipped>
}

/** One window, named in its own row: the plan decides which windows a row has (variant 2 of BTN-575). */
function AccountMeter({ entry, span, now }: { entry: AccountEntry; span: LimitSpan; now: Date }) {
  const { label, title } = spanNames(span)
  return <Meter entry={entry} now={now} window={entry.limits?.[span] ?? null} label={label} short={t.limits.short[span]} title={title} />
}

/** A model's own week (BTN-805), after the plan's windows and named by the model the server gave. */
function ModelMeter({ entry, week, now }: { entry: AccountEntry; week: ModelWeek; now: Date }) {
  return <Meter entry={entry} now={now} window={week} label={t.limits.modelWeek(week.model)} short={week.model} title={t.limits.modelWeekTitle(week.model)} />
}

interface MeterProps {
  entry: AccountEntry
  now: Date
  window: (Pick<LimitWindow, 'usedPercentage' | 'left' | 'used'> & { resetsAt: string | null }) | null
  label: string
  short: string
  title: string
}

function Meter({ entry, now, window, label, short, title }: MeterProps) {
  const percent = window === null ? 0 : Math.round(Math.max(0, Math.min(100, window.usedPercentage)))
  const heat = entry.limitsOutdated ? ' account-value--outdated' : percent >= FULL_PERCENT ? ' account-value--full' : percent >= WARM_PERCENT ? ' account-value--warm' : ''
  const reset = window?.resetsAt == null ? '' : formatSpan(window.resetsAt, now)
  const source = entry.limits === null ? '' : t.limits.updated(t.limits.sources[entry.limits.source], formatAgo(entry.limits.updatedAt, now))
  const count = window === null || (window.left === undefined && window.used === undefined) ? null : windowValue(window, percent)
  const when = window === null ? t.account.noLimits : window.resetsAt === null ? t.limits.noReset(title) : t.limits.reset(title, reset, '')
  const tip = [when, count, source, outdatedText(entry, now), staleText(entry), limitsNote(entry)].filter(Boolean).join(' · ')
  return <Tipped className={`account-meter${heat}`} tip={tip} align="start" focusable>
    <span className="account-meter__top">
      <span className="account-meter__what"><span className="account-meter__name">
        <span className="account-meter__long">{label}</span><span className="account-meter__short">{short}</span>
      </span><strong>{window === null ? t.limits.noData : <>
        <span className="account-meter__long">{windowValue(window, percent)}</span><span className="account-meter__short">{windowValue(window, percent, true)}</span>
      </>}</strong></span>
      {reset !== '' && <span>{reset}</span>}
    </span>
    <span className="account-meter__bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
  </Tipped>
}

export function CompactLimit({ entry, now }: { entry: AccountEntry | undefined; now: Date }) {
  const tightest = entry === undefined || limitsNote(entry) !== null ? null : tightestWindow(entry.limits)
  if (tightest === null) return <span className="account-compact__none">—</span>
  const used = 100 - tightest.free
  const heat = entry?.limitsOutdated ? ' account-value--outdated' : used >= FULL_PERCENT ? ' account-value--full' : used >= WARM_PERCENT ? ' account-value--warm' : ''
  const summary = t.account.freeTip(spanNames(tightest.span).title, tightest.free, formatSpan(tightest.window.resetsAt, now))
  const source = entry?.limits == null ? '' : t.limits.updated(t.limits.sources[entry.limits.source], formatAgo(entry.limits.updatedAt, now))
  const notes = entry === undefined ? [] : [outdatedText(entry, now), staleText(entry)]
  return <Tipped inline focusable className={`account-compact__value${heat}`} tip={[summary, source, ...notes].filter(Boolean).join(' · ')}>{used}%</Tipped>
}

/** Limits older than a poll's interval that no poll has confirmed since the restart (BTN-631). */
export function outdatedText(entry: AccountEntry, now: Date): string | null {
  return entry.limitsOutdated && entry.limits !== null ? t.limits.outdated(formatAgo(entry.limits.updatedAt, now)) : null
}
