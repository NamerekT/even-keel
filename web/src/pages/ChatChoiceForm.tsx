import { useEffect, useState, type ReactNode } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import { EFFORTS } from '../../../src/agent/providers.js'
import type { ChatChoice, ChatMachine, ChatMachines } from '../../../src/chats/model.js'
import { limitSpans, type LimitSpan } from '../../../src/limits/model.js'
import { accountName, agentLabel } from '../accountName.js'
import { accountGroups, tightestWindow, type AccountGroup } from '../accounts.js'
import { formatSpan, formatStamp } from '../format.js'
import { t } from '../i18n/index.js'
import { AgentIcon } from '../layout/accountParts.js'
import { spanNames } from '../layout/Limits.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { Segmented } from '../stats/common.js'
import { FoldBody, FoldToggle } from '../ui/Fold.js'
import { MachineMark } from '../ui/MachineIcon.js'
import { Select } from '../ui/Select.js'
import { TipFacts } from '../ui/TipFacts.js'
import { Tipped } from '../ui/Tipped.js'
import { accountAfter, agentsOpen, agentToggled, chatOptions, machineChoices, machineFirst, machinePanel } from './chatMachines.js'
import { HelpTip } from './settingsParts.js'
import { modelsReading, offersOf, useModelCatalog, type ModelAnswer } from './useModels.js'
import './chats.css'

/** An account on a limit or waiting for a sign-in cannot start a chat: why, and until when for a limit. */
export function blockOf(entry: AccountEntry, now: Date): string | null {
  if (entry.needsLogin) return t.chats.dialog.login
  const tightest = tightestWindow(entry.limits)
  return tightest !== null && tightest.free === 0 ? t.chats.dialog.limit(formatStamp(tightest.window.resetsAt, now)) : null
}

/** What a chat starts with: the machine (`null` — the hub's pick), the account, the model and the effort (`''` — the CLI's). */
export interface ChatPick {
  machine: string | null
  account: AccountEntry | undefined
  model: string
  effort: string
}

/** The state of the choice form, from `useChatChoice`, rendered by `ChatChoiceForm`. */
export interface ChatChoiceState {
  pick: ChatPick
  now: Date
  machines: ChatMachine[]
  setMachine: (machine: string) => void
  groups: AccountGroup[]
  /** The machine's accounts, which an account's name is told apart among. */
  names: AccountEntry[] | undefined
  /** Accounts open to a chat on the machine: none — the window says so. */
  open: AccountEntry[]
  /** The machine picked has not told its accounts yet. */
  unread: boolean
  setAccount: (account: string) => void
  agents: ReadonlySet<string>
  toggleAgent: (agent: string) => void
  catalog: Record<string, ModelAnswer>
  setModel: (model: string) => void
  efforts: readonly string[]
  setEffort: (effort: string) => void
}

/**
 * The choice of a new chat (BTN-1710), offered from the project's last one: its machine while it can take a chat, its
 * account where it is open there, its model and effort. The agent of the account offered first is unfolded; a fold by
 * hand stays over a change of the machine. `agent` — that of the choice's account where the page's own accounts may not
 * have it, a chat's on a machine elsewhere (BTN-1711), so its model stays.
 */
export function useChatChoice(project: string, choice: ChatChoice | null, agent?: string): ChatChoiceState {
  const { state, query } = useLive()
  const now = useNow(30_000)
  const [answer, setAnswer] = useState<ChatMachines | null>(null)
  const [machine, setMachine] = useState<string | null>(null)
  const shownMachine = machine ?? machineFirst(answer, choice?.machine)
  const view = machinePanel(answer, shownMachine, state?.account)
  const groups = view === undefined ? [] : accountGroups(chatOptions(view), now)
  const open = groups.flatMap((group) => group.entries).filter((entry) => blockOf(entry, now) === null)
  const [wanted, setAccount] = useState(choice?.account ?? '')
  // The account follows the machine: one the machine picked has not, or not open, gives way to the first that is (BTN-1614).
  const entry = accountAfter(open, wanted, choice?.account)
  // A model is the CLI's of one agent: it stays while the account picked is of that agent.
  const [model, setModel] = useState(() => ({ agent: state?.account.accounts.find((each) => each.key === choice?.account)?.agent ?? agent ?? '', value: choice?.model ?? '' }))
  const shownModel = entry !== undefined && entry.agent === model.agent ? model.value : ''
  const efforts = entry === undefined ? [] : (EFFORTS[entry.agent] ?? [])
  const [effort, setEffort] = useState(choice?.effort ?? 'medium')
  const shownEffort = efforts.includes(effort) ? effort : (efforts.find((each) => each === 'medium') ?? efforts[0] ?? '')
  const catalog = useModelCatalog(entry === undefined ? [] : [entry.key])
  // The agent unfolded at the start is the one of the account offered once the machines are known; by hand it is the user's.
  const [firstAgent, setFirstAgent] = useState<string | undefined>(undefined)
  const [byHand, setByHand] = useState<Set<string> | null>(null)
  const agents = agentsOpen(byHand, firstAgent ?? entry?.agent)

  useEffect(() => {
    if (answer !== null && firstAgent === undefined && entry !== undefined) setFirstAgent(entry.agent)
  }, [answer, firstAgent, entry])

  useEffect(() => {
    let live = true
    query<ChatMachines>('chats/machines', { project }).then(
      (each) => {
        if (live) setAnswer(each)
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [project])

  return {
    pick: { machine: shownMachine, account: entry, model: shownModel, effort: shownEffort },
    now,
    machines: machineChoices(answer),
    setMachine,
    groups,
    names: view?.accounts,
    open,
    unread: shownMachine !== null && view === undefined,
    setAccount,
    agents,
    toggleAgent: (agent) => setByHand(agentToggled(agents, agent)),
    catalog,
    setModel: (value) => setModel({ agent: entry?.agent ?? '', value }),
    efforts,
    setEffort,
  }
}

/**
 * The form of a new chat's choice: the machine above the scrolling body, so a long list of accounts never takes it out
 * of view (BTN-1670); in the body the accounts by agent, each agent folding, with their limits, then the model and the
 * effort. `lead` — what a window says above it all, the renewal's why and message (BTN-1711).
 */
export function ChatChoiceForm({ project, state, lead }: { project: string; state: ChatChoiceState; lead?: ReactNode }) {
  const { pick, now, groups, open, agents } = state
  const account = pick.account?.key ?? ''
  const offers = offersOf(state.catalog, account)
  const models = [{ value: '', label: t.settings.cliDefault }, ...[...new Set([...offers, ...(pick.model === '' ? [] : [pick.model])])].map((each) => ({ value: each, label: each }))]
  return (
    <>
      {lead !== undefined && <div className="new-chat__lead">{lead}</div>}
      {state.machines.length > 0 && <MachineSelect machines={state.machines} picked={pick.machine} onPick={state.setMachine} />}
      <div className="add-package__body new-chat__body">
        {state.unread ? (
          <p className="notice notice--warn">{t.chats.dialog.unread}</p>
        ) : groups.length === 0 || open.length === 0 ? (
          <p className="notice notice--warn">{t.chats.dialog.none}</p>
        ) : null}
        <div role="radiogroup" aria-label={t.chats.dialog.accounts} className="new-chat__groups">
          {groups.map((group) => {
            const unfolded = agents.has(group.agent)
            const picked = group.entries.find((each) => each.key === account)
            const body = `new-chat-${group.agent}`
            return (
              <section key={group.agent} className="new-chat__group">
                <h3 className="new-chat__agent">
                  <FoldToggle className="new-chat__toggle" aria-expanded={unfolded} aria-controls={body} onClick={() => state.toggleAgent(group.agent)}>
                    <AgentIcon agent={group.agent} />
                    <span className="new-chat__agent-name">{agentLabel(group.agent)}</span>
                    {!unfolded && picked !== undefined && <span className="new-chat__folded-pick">{accountName(picked, state.names)}</span>}
                  </FoldToggle>
                </h3>
                <FoldBody open={unfolded} id={body}>
                  <div className="new-chat__entries">
                    {group.entries.map((each) => (
                      <AccountPick key={each.key} entry={each} project={project} picked={each.key === account} name={accountName(each, state.names)} now={now} onPick={state.setAccount} />
                    ))}
                  </div>
                </FoldBody>
              </section>
            )
          })}
        </div>
        <div className="new-chat__fields">
          <div className="new-chat__field">
            <span className="new-chat__label">{t.chats.dialog.model}</span>
            <Select className="add-package__input" value={pick.model} options={models} onChange={state.setModel} label={t.chats.dialog.model} loading={modelsReading(state.catalog, account)} disabled={pick.account === undefined} />
          </div>
          {state.efforts.length > 0 && (
            <div className="new-chat__field">
              <span className="new-chat__label">
                {t.chats.dialog.effort}
                <HelpTip text={t.chats.dialog.effortTip} />
              </span>
              <Segmented label={t.chats.dialog.effort} options={state.efforts.map((each) => [each, each] as [string, string])} value={pick.effort} onChange={state.setEffort} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function AccountPick({ entry, project, picked, name, now, onPick }: { entry: AccountEntry; project: string; picked: boolean; name: string; now: Date; onPick: (account: string) => void }) {
  const blocked = blockOf(entry, now)
  return (
    <label className={`new-chat__pick${picked ? ' new-chat__pick--on' : ''}${blocked === null ? '' : ' new-chat__pick--off'}`}>
      <input type="radio" name="account" value={entry.key} checked={picked} disabled={blocked !== null} onChange={() => onPick(entry.key)} />
      <span className="new-chat__name">
        <span className="new-chat__who">{name}</span>
        {entry.projects.includes(project) && (
          <Tipped inline tip={t.chats.dialog.chainTip}>
            <span className="tag new-chat__chain">{t.chats.dialog.chain}</span>
          </Tipped>
        )}
      </span>
      {blocked !== null ? <span className="new-chat__blocked">{blocked}</span> : <Bars entry={entry} now={now} />}
    </label>
  )
}

/**
 * The machines of a project with more than one (BTN-1614) as one pick with each machine's mark (BTN-1710): one off the
 * link or without the project's folder stays in the list, unavailable, with its reason.
 */
function MachineSelect({ machines, picked, onPick }: { machines: ChatMachine[]; picked: string | null; onPick: (machine: string) => void }) {
  const text = t.chats.dialog
  const options = machines.map((each) => ({
    value: each.id,
    label: each.name,
    icon: <MachineMark id={each.id} />,
    ...(each.block !== null && { unavailable: each.block === 'offline' ? text.offline : text.noFolder }),
  }))
  return (
    <div className="new-chat__field new-chat__machines">
      <span className="new-chat__label">{text.machine}</span>
      <Select className="add-package__input" value={picked ?? ''} options={options} onChange={onPick} label={text.machine} />
    </div>
  )
}

/** A bar's tip: the window's name as the head, how much is used and when it resets as captioned rows. */
export function barTip(span: LimitSpan, used: number, resetsAt: string, now: Date): ReactNode {
  return (
    <TipFacts
      head={spanNames(span).title}
      rows={[
        [t.limits.facts.used, `${used}%`],
        [t.limits.facts.resets, formatSpan(resetsAt, now)],
      ]}
    />
  )
}

/** The account's five-hour and weekly windows as thin bars; the window's name and its reset in the tip. */
function Bars({ entry, now }: { entry: AccountEntry; now: Date }) {
  // `limitSpans` lists a window not read yet too: only the read ones get a bar.
  const windows = limitSpans(entry.limits).flatMap((span) => {
    const window = span === 'month' ? undefined : entry.limits?.[span]
    return window == null ? [] : [{ span, window }]
  })
  if (windows.length === 0) return null
  return (
    <span className="new-chat__bars">
      {windows.map(({ span, window }) => {
        const used = Math.round(Math.min(Math.max(window.usedPercentage, 0), 100))
        return (
          <Tipped key={span} inline tip={barTip(span, used, window.resetsAt, now)}>
            <span className="new-chat__bar">
              <span className="new-chat__meter" aria-hidden="true">
                <span className={used >= 100 ? 'new-chat__fill new-chat__fill--full' : 'new-chat__fill'} style={{ width: `${used}%` }} />
              </span>
              {used}%
            </span>
          </Tipped>
        )
      })}
    </span>
  )
}
