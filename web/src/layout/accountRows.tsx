import type { PackagesView } from '../../../src/state.js'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { limitSpans, type LimitSpan, type LimitWindow, type ModelWeek } from '../../../src/limits/model.js'
import { OPENCODE } from '../../../src/opencode/name.js'
import { agentLabel } from '../accountName.js'
import { ACCESS_OWNER, accessGroups, accountGroups, PROVIDERS, tightestWindow, type Access, type Provider } from '../accounts.js'
import { formatAgo, formatSpan, formatTokens } from '../format.js'
import { overageTexts, say, t } from '../i18n/index.js'
import { tokenTag } from '../longToken.js'
import { formatUsd } from '../stats/format.js'
import { Band, Card } from '../ui/blocks.js'
import { seriesStyle } from '../ui/series.js'
import { Tipped } from '../ui/Tipped.js'
import { AccountRowMenu } from './AccountRowMenu.js'
import { useNarrow } from './useNarrow.js'
import { OwnSettings } from './accountSettings.js'
import { AccountMarketplace } from './AccountMarketplace.js'
import { AccountWork, rolesOf } from './AccountRoles.js'
import { useOpenAdd } from './AddAccountDialog.js'
import { AccountMark, AccountName, AgentIcon, KeepButton, limitsNote, planText, sharedLimitText, spendsByKey, staleText, TransportNote, type Send, type Spend, type Tokens } from './accountParts.js'
import { accountAnchor, AccountProblem } from './accountProblems.js'
import { FULL_PERCENT, spanNames, WARM_PERCENT, windowFact, windowValue } from './Limits.js'
import { HelpTip } from '../pages/settingsParts.js'
import { TipFacts, type TipFact } from '../ui/TipFacts.js'
import { AccountMachines, MachineNotes } from './MachineSignIns.js'
import { MachineTokenNote } from './MachineTokenNote.js'
import { useLive } from '../live/context.js'
import { OverageChip, OverageValue, OverageWarning } from './Overage.js'
import './accountRows.css'
import { copilotNote, hasCopilot } from '../../../src/opencode/support.js'
import { InfoIcon } from '../ui/icons.js'
import { useProjectLabel } from '../ui/ProjectLabel.js'
import type { MachineUse } from '../machineAccountView.js'
import { rowSlot, type MachineRows } from './machineRows.js'

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
  /** The page's "Machines" column (BTN-1309): the hub has machines elsewhere. */
  machines?: boolean
  /** A machine elsewhere's view (BTN-1570): its accounts, with no control of the hub's folders. */
  machine?: MachineRows
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
  const { view, now, page = false, marketplace, machine } = props
  const openAdd = useOpenAdd()
  const signIns = useLive().state?.machineSignIns
  const machines = page && machine === undefined && (signIns?.length ?? 0) > 0
  // A machine's view keeps the rows it is not signed in to at the end of their group: its own signed out, then the hub's.
  const rank = (entry: AccountEntry) => [undefined, 'out', 'hub'].indexOf(machine?.away.get(entry.key)?.why)
  const groups = accountGroups({ ...view, accounts: entries ?? view.accounts }, now).map((group) => machine === undefined ? group : {
    ...group, entries: [...group.entries].sort((a, b) => rank(a) - rank(b)),
  })
  return <div className={page ? `account-blocks account-blocks--page${machines ? ' account-blocks--machines' : ''}` : 'account-blocks'}>
    {groups.map(({ agent, entries: rows }) => <Card key={agent} className="account-provider" title={<>
      <span className="account-provider__icon"><AgentIcon agent={agent} /></span>
      {agentLabel(agent)}
      <span className="account-provider__count">{groupCount(rows, machine)}</span>
    </>} actions={page ? <>
      {agent === 'claude' && marketplace != null && machine === undefined && <AccountMarketplace marketplace={marketplace} send={props.send} sending={props.sending} />}
      {view.login === null && (PROVIDERS as readonly string[]).includes(agent) && <button type="button" className="button button--small"
        disabled={machine?.addOff === true}
        // A machine's "Add" opens the pick of the place, the machine picked: an opener naming the agent adds on the hub.
        onClick={() => openAdd(machine === undefined ? agent as Provider : null)}>+ {t.account.addHere}</button>}
    </> : undefined}>
      {accessGroups(rows).map(({ access, entries: members }) => <AccessBlock key={access} agent={agent} access={access} rows={members} {...props} machines={machines} />)}
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
      <span className="account-access__title">{accessLabel(access, agent)}<span className="count-badge">{rows.length}</span>
        {measure === 'tokens' && <HelpTip text={t.account.tokensSource} align="start" />}</span>
      {page && <span aria-hidden="true">{t.account.usedByLabel}</span>}
      {props.machines === true && <span aria-hidden="true">{t.account.machinesLabel}</span>}
      <div className={`account-window-heads account-window-heads--${columns.length}`} aria-hidden="true">{columns.map((label) => <span key={label}>{label}</span>)}</div>
      {page && <><span aria-hidden="true">{overageTexts().column}</span><span aria-hidden="true">{t.account.sessionsLabel}</span><span aria-hidden="true">{t.account.runsThrough}</span></>}
    </div>
    <ul className="account-rows">{rows.map((entry) => <li key={entry.key} id={accountAnchor(entry.key)} style={seriesStyle(rowSlot(view, entry, props.machine))}>
      {props.machine === undefined ? <AccountRow entry={entry} access={access} named={measure === 'limits'} {...props} />
        : <MachineRow entry={entry} machine={props.machine} now={props.now} page={page} />}
    </li>)}</ul>
  </section>
}

/** A group's count; in a machine's view, with a row it is not signed in to, how many of them are signed in there. */
function groupCount(rows: AccountEntry[], machine: MachineRows | undefined): string {
  const here = machine === undefined ? rows.length : rows.filter((entry) => !machine.away.has(entry.key)).length
  return here === rows.length ? t.account.accountCount(rows.length) : t.machinePanel.view.accountsHere(here, rows.length)
}

/**
 * A row of a machine elsewhere's view (BTN-1570): the limits the machine read and the levels it takes the account at.
 * Its own folder has the hub row's menu, each item done on the machine (BTN-1584); one the machine is not signed in
 * to says so in a note's tone, with "Sign in" there. A folder on a long token is tagged so, with its note under the row.
 */
function MachineRow({ entry, machine, now, page }: { entry: AccountEntry; machine: MachineRows; now: Date; page: boolean }) {
  const away = machine.away.get(entry.key)
  const uses = machine.uses.get(entry.key) ?? []
  const token = machine.tokens.get(entry.key)
  const plan = token === undefined ? planText(entry) : t.account.longToken
  const chips = <div className="account-role-chips">
    {away !== undefined && <span className="account-role account-role--away"><InfoIcon />{away.global !== undefined ? t.machinePanel.view.notAdded : away.why === 'hub' ? t.machinePanel.view.hubOnly : t.machinePanel.view.signedOut}</span>}
    {(away === undefined || !page) && <MachineUses uses={uses} none={away === undefined} />}
  </div>
  const className = `account-row--machine${away === undefined ? '' : ' account-row--away'}`
  const grid = <div className="account-grid">
      <div className="account-who">
        <div className="account-who__name"><AccountMark entry={entry} now={now} dot folder={machine.folders.get(entry.key) ?? null} />
          <AccountName entry={entry} accounts={machine.view.accounts} whole={!page} />
          {away === undefined && <OverageChip entry={entry} now={now} />}
          {plan !== null && !entry.apiKey && entry.agent !== OPENCODE && <span className="tag account-plan">{plan}</span>}
        </div>
        {!page && chips}
      </div>
      {away !== undefined ? <>
        {page && <div className="account-away">{chips}</div>}
        <div className="account-away__sign">{machine.signIn(away)}</div>
      </> : <>
        {page && chips}
        <div className="account-windows">
          {limitSpans(entry.limits).map((span) => <AccountMeter key={span} entry={entry} span={span} now={now} />)}
          {entry.limits?.models?.weeks.map((week) => <ModelMeter key={`model:${week.model}`} entry={entry} week={week} now={now} />)}
        </div>
        {page && <><OverageValue entry={entry} now={now} /><div className="account-detail"><AccountWork entry={entry} view={machine.view} /></div><div className="account-detail"><TransportNote entry={entry} brief /></div></>}
        <div className="account-compact"><CompactLimit entry={entry} now={now} bare /></div>
      </>}
    </div>
  // A subscription of the hub with no folder there has nothing to change on the machine: only "Sign in".
  if (away?.why === 'hub') return <div className={`account-row ${className}`}>{grid}</div>
  return <AccountRowMenu entry={entry} view={machine.view} send={machine.send} sending={machine.busy} className={className}
    off={machine.online ? undefined : t.machinePanel.view.accountsOffline(machine.card.name)} switchOff={machine.switchOff(entry.key)}>
    {grid}
    {token !== undefined && <MachineTokenNote token={token} machine={machine} />}
    {entry.removing && <Band tone="warn" className="account-problem" action={<KeepButton entry={entry} sending={machine.busy} send={machine.send} />}>
      {t.account.removing}{entry.sessions.length > 0 ? t.account.removingAlive(entry.sessions.join(', ')) : ''}
    </Band>}
  </AccountRowMenu>
}

/** "Used by" of a machine's row: Even Keel, a project, a task — where the machine takes the account. */
function MachineUses({ uses, none }: { uses: MachineUse[]; none: boolean }) {
  const label = useProjectLabel()
  if (uses.length === 0) return none ? <span className="account-role account-role--none">{t.account.rolesNone}</span> : null
  return uses.map((use) => {
    const text = use.source === 'shared' ? 'Even Keel' : use.source === 'task' ? t.machinePanel.view.useTask(use.task!) : label(use.project!)
    return <span key={text} className={`account-role account-role--${use.source === 'shared' ? 'chain' : use.source}`}>{text}</span>
  })
}

/** `named` — the head says only "Limits", so each value in the row names its window or period itself. */
function AccountRow({ entry, access, named, ...props }: RowsProps & { entry: AccountEntry; access: Access; named: boolean }) {
  const { view, now, send, sending, spend, tokens, page = false, fresh = [] } = props
  const held = rolesOf(entry, view, send).filter((role) => role.held)
  const plan = planText(entry)
  const shared = sharedLimitText(entry, view.accounts)
  const unsupported = access === 'github' && hasCopilot(entry)
  const roles = <div className="account-role-chips">{held.length === 0 ? <span className="account-role account-role--none">{unsupported ? t.account.notSupported : t.account.rolesNone}</span> :
    held.map((role) => <span key={role.label} className={`account-role account-role--${role.label === 'Even Keel' ? 'chain' : 'app'}`}>{role.label}</span>)}</div>
  const counted = limitsNote(entry) !== null
  const sums = spendsByKey(entry) ? spend?.[entry.key] ?? null : tokens?.[entry.key] ?? null
  const tip = entry.cloud !== undefined ? t.account.cloudSpendTitle : spendsByKey(entry) ? t.account.spendTitle : <>
    <span>{limitsNote(entry)}</span>
    <span className="tip__muted">{t.account.tokensTitle}</span>
    {entry.lastLimitAt != null && <span>{t.account.lastLimit(formatAgo(entry.lastLimitAt, now))}</span>}</>
  const measured = spendsByKey(entry) ? spend : tokens
  const loaded = measured != null
  return <AccountRowMenu entry={entry} view={view} send={send} sending={sending} fresh={fresh.includes(entry.key)} head={<NarrowMenuHead entry={entry} now={now} />}>
    <div className="account-grid">
      <div className="account-who">
        <div className="account-who__name"><AccountMark entry={entry} now={now} dot /><AccountName entry={entry} accounts={view.accounts} whole={!page} />
          <OverageChip entry={entry} now={now} />
          {shared !== null && <Tipped className="account-shared" tip={shared} align="start" focusable inline>⇄</Tipped>}
          {plan !== null && !entry.apiKey && entry.agent !== OPENCODE && <span className="tag account-plan">{entry.longToken === undefined ? plan : tokenTag(entry.longToken)}</span>}
        </div>
        {!page && roles}
        {entry.status?.loggedIn === null && <span className="account-row__error account-row__unknown">{t.account.authUnknown}</span>}
        {outdatedText(entry, now) !== null && <span className="account-row__outdated">{outdatedText(entry, now)}</span>}
        <Resets entry={entry} now={now} />
      </div>
      {page && roles}
      {props.machines === true && <div className="account-detail account-machine-cell"><AccountMachines entry={entry} send={send} sending={sending} /></div>}
      <div className="account-windows">
        {spendsByKey(entry) || counted ? <>
          {(['day', 'month'] as const).map((period) => <Tipped key={period} className="account-sum" tip={tip} align="start" focusable>
            {named && <span className="account-meter__name">{period === 'day' ? t.account.tokensToday : t.account.tokensMonth}</span>}
            <strong>{measured === undefined ? '…' : !loaded ? '—' : spendsByKey(entry) ? formatUsd(sums?.[period] ?? 0) : formatTokens(sums?.[period] ?? 0)}</strong>
          </Tipped>)}
          {spendsByKey(entry) && entry.keyLimit !== undefined && <KeyLeft entry={entry} now={now} />}
          {spendsByKey(entry) && entry.balance !== undefined && <Balance entry={entry} now={now} />}
        </> : <>
          {limitSpans(entry.limits).map((span) => <AccountMeter key={span} entry={entry} span={span} now={now} />)}
          {entry.limits?.models?.weeks.map((week) => <ModelMeter key={`model:${week.model}`} entry={entry} week={week} now={now} />)}
        </>}
      </div>
      {page && <><OverageValue entry={entry} now={now} /><div className="account-detail"><AccountWork entry={entry} view={view} /></div><div className="account-detail"><TransportNote entry={entry} brief /></div></>}
      <div className="account-compact">
        {!counted && entry.limits?.models?.weeks.map((week) => <span key={week.model} className="tag account-compact__model">{week.model}</span>)}
        <CompactLimit entry={entry} now={now} bare />
      </div>
    </div>
    <AccountProblem entry={entry} view={view} now={now} send={send} sending={sending} />
    <OverageWarning entry={entry} view={view} />
    <MachineNotes entry={entry} send={send} sending={sending} />
    {page && <OwnSettings entry={entry} send={send} sending={sending} />}
    {hasCopilot(entry) && !(unsupported && held.length === 0) && <p className="account-provider__state">{say(copilotNote())}</p>}
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
  const read = t.account.keyLimitTitle(formatUsd(remaining), formatUsd(limit), t.account.keyLimitResets[reset ?? 'never'], formatAgo(at, now))
  const tip = entry.managementKey === false && entry.balance === undefined ? `${read} ${t.account.balanceNeedsKey}` : read
  return <Tipped className={`account-sum${heat}`} tip={tip} align="start" focusable>
    <span className="account-meter__name">{t.account.keyLeft}</span>
    <strong>{formatUsd(remaining)}</strong>
  </Tipped>
}

/**
 * The OpenRouter account's balance as its own key (BTN-1206) or its management key (BTN-868) last read it, or that the
 * management key was refused.
 */
function Balance({ entry, now }: { entry: AccountEntry; now: Date }) {
  const balance = entry.balance!
  const ago = formatAgo(balance.at, now)
  const refused = 'rejected' in balance
  const heat = refused || balance.usd <= 0 ? ' account-value--full' : ''
  return <Tipped className={`account-sum${heat}`} tip={refused ? t.account.balanceRefusedTitle(ago) : t.account.balanceTitle(ago)} align="start" focusable>
    <span className="account-meter__name">{t.account.balance}</span>
    <strong>{refused ? t.account.balanceRefused : formatUsd(balance.usd)}</strong>
  </Tipped>
}

/** One window, named in its own row: the plan decides which windows a row has (variant 2 of BTN-575). */
function AccountMeter({ entry, span, now, plain }: { entry: AccountEntry; span: LimitSpan; now: Date; plain?: boolean }) {
  const { label, title } = spanNames(span)
  return <Meter entry={entry} now={now} window={entry.limits?.[span] ?? null} label={label} short={t.limits.short[span]} title={title} plain={plain} />
}

/** A model's own week (BTN-805), after the plan's windows and named by the model the server gave. */
function ModelMeter({ entry, week, now, plain }: { entry: AccountEntry; week: ModelWeek; now: Date; plain?: boolean }) {
  return <Meter entry={entry} now={now} window={week} label={t.limits.modelWeek(week.model)} short={week.model} title={t.limits.modelWeekTitle(week.model)} plain={plain} />
}

/**
 * The counters a narrow row hides, at the head of its menu (BTN-1043): the plan's windows and the models' weeks with
 * their resets, then the reading's source and age and its notes. No control and no tips: the tap opens only the menu.
 */
export function MenuMeters({ entry, now }: { entry: AccountEntry; now: Date }) {
  if (!metered(entry) || entry.limits === null) return null
  const read = t.limits.updated(t.limits.sources[entry.limits.source], formatAgo(entry.limits.updatedAt, now))
  return <div className="account-row__meters">
    {limitSpans(entry.limits).map((span) => <AccountMeter key={span} entry={entry} span={span} now={now} plain />)}
    {entry.limits.models?.weeks.map((week) => <ModelMeter key={`model:${week.model}`} entry={entry} week={week} now={now} plain />)}
    {[read, outdatedText(entry, now), staleText(entry)].filter(Boolean).map((note) => <span key={note} className="account-row__meters-aside">{note}</span>)}
    {resetsText(entry) !== null && <span className="account-row__meters-aside">{resetsText(entry)}</span>}
  </div>
}

/** The limit resets the ChatGPT account has banked (BTN-1269), shown once there is one: the user spends it, never Even Keel. */
function Resets({ entry, now }: { entry: AccountEntry; now: Date }) {
  const resets = entry.limits?.resets
  const text = resetsText(entry)
  if (resets === undefined || text === null) return null
  const tip = t.account.resetsTitle(resets.applicable === null ? null : String(resets.applicable), formatAgo(resets.updatedAt, now))
  return <Tipped inline focusable className="account-row__resets" tip={tip} align="start">{text}</Tipped>
}

function resetsText(entry: AccountEntry): string | null {
  const resets = entry.limits?.resets
  return resets === undefined || resets.available === 0 ? null : t.account.resets(String(resets.available))
}

function metered(entry: AccountEntry): boolean {
  return entry.limits !== null && limitsNote(entry) === null && !spendsByKey(entry)
}

/** `MenuMeters` as the menu's first item on a narrow screen; a wide row shows the counters itself. */
function NarrowMenuHead({ entry, now }: { entry: AccountEntry; now: Date }) {
  const narrow = useNarrow()
  if (!narrow || !metered(entry)) return null
  return <>
    <li role="none" className="account-row__menu-head"><MenuMeters entry={entry} now={now} /></li>
    <li role="separator" className="account-row__separator" />
  </>
}

interface MeterProps {
  entry: AccountEntry
  now: Date
  window: (Pick<LimitWindow, 'usedPercentage' | 'left' | 'used'> & { resetsAt: string | null }) | null
  label: string
  short: string
  title: string
  /** Without its tip, where the source and notes are written once under all the windows. */
  plain?: boolean
}

function Meter({ entry, now, window, label, short, title, plain = false }: MeterProps) {
  const percent = window === null ? 0 : Math.round(Math.max(0, Math.min(100, window.usedPercentage)))
  const heat = entry.limitsOutdated ? ' account-value--outdated' : percent >= FULL_PERCENT ? ' account-value--full' : percent >= WARM_PERCENT ? ' account-value--warm' : ''
  const reset = window?.resetsAt == null ? '' : formatSpan(window.resetsAt, now)
  const tip = <TipFacts head={title} rows={[
    window === null ? null : [t.limits.facts.resets, window.resetsAt === null ? t.limits.notGiven : reset],
    window === null ? null : windowFact(window),
    sourceFact(entry, now),
  ]} notes={[window === null ? t.account.noLimits : null, outdatedText(entry, now), staleText(entry), limitsNote(entry)]} />
  const body = <>
    <span className="account-meter__top">
      <span className="account-meter__what"><span className="account-meter__name">
        <span className="account-meter__long">{label}</span><span className="account-meter__short">{short}</span>
      </span><strong>{window === null ? t.limits.noData : <>
        <span className="account-meter__long">{windowValue(window, percent)}</span><span className="account-meter__short">{windowValue(window, percent, true)}</span>
      </>}</strong></span>
      {reset !== '' && <span>{reset}</span>}
    </span>
    <span className="account-meter__bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
  </>
  return plain ? <span className={`account-meter${heat}`}>{body}</span> : <Tipped className={`account-meter${heat}`} tip={tip} align="start" focusable>{body}</Tipped>
}

/** `bare` — in an account row, whose menu holds what the tip would say (`MenuMeters`), so a tap opens one thing. */
export function CompactLimit({ entry, now, bare = false }: { entry: AccountEntry | undefined; now: Date; bare?: boolean }) {
  const tightest = entry === undefined || limitsNote(entry) !== null ? null : tightestWindow(entry.limits)
  if (tightest === null) return <span className="account-compact__none">—</span>
  const used = 100 - tightest.free
  const heat = entry?.limitsOutdated ? ' account-value--outdated' : used >= FULL_PERCENT ? ' account-value--full' : used >= WARM_PERCENT ? ' account-value--warm' : ''
  if (bare) return <span className={`account-compact__value${heat}`}>{used}%</span>
  const tip = <TipFacts head={t.account.tightest(spanNames(tightest.span).title)} rows={[
    [t.limits.facts.free, `${tightest.free}%`],
    [t.limits.facts.resets, formatSpan(tightest.window.resetsAt, now)],
    entry === undefined ? null : sourceFact(entry, now),
  ]} notes={entry === undefined ? [] : [outdatedText(entry, now), staleText(entry)]} />
  return <Tipped inline focusable className={`account-compact__value${heat}`} tip={tip}>{used}%</Tipped>
}

/** Where the account's limits were read and how long ago, as a tip's "Source"; `null` — never read. */
function sourceFact(entry: AccountEntry, now: Date): TipFact {
  return entry.limits === null ? null : [t.limits.facts.source, t.limits.updated(t.limits.origins[entry.limits.source], formatAgo(entry.limits.updatedAt, now))]
}

/** Limits older than a poll's interval that no poll has confirmed since the restart (BTN-631). */
export function outdatedText(entry: AccountEntry, now: Date): string | null {
  return entry.limitsOutdated && entry.limits !== null ? t.limits.outdated(formatAgo(entry.limits.updatedAt, now)) : null
}
