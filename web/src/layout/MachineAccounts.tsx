import type { MachineCard, MachineSignIn } from '../../../src/state.js'
import { entrySlot } from '../accounts.js'
import { headerAccounts, type HeaderAccount } from '../headerAccounts.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { machineAccountsEmpty } from '../machineAdd.js'
import { machineAccountView, machineLevels, machineUses } from '../machineAccountView.js'
import { gapCommand, machineLogin } from '../machineSignIn.js'
import { MachineLabels } from '../ui/MachineLabel.js'
import { seriesStyle } from '../ui/series.js'
import { Tipped } from '../ui/Tipped.js'
import { ViewAccountPanel } from './Account.js'
import { AccountBlock } from './AccountBlock.js'
import { agentLabel } from '../accountName.js'
import { AgentIcon } from './accountParts.js'
import { Limits } from './Limits.js'
import { FolderSignIn } from './MachineFolderSignIn.js'
import { useMachineFilter } from './MachineFilter.js'
import { machineSend, machineSwitchOff, type MachineRows } from './machineRows.js'
import { usePopover } from './usePopover.js'
import './machineAccounts.css'

/**
 * The header's accounts block in a machine's view: a machine elsewhere's is the hub's own block over its accounts
 * (BTN-1570). In "All machines" a lamp per account Even Keel uses, its window a block per account with the machines it
 * is signed in on as labels (BTN-1309). The own machine's view keeps the hub's own block (`AccountBlock`).
 */
export function MachineAccountsBlock({ now, project }: { now: Date; project?: string }) {
  const { selected } = useMachineFilter()
  return selected === null ? <AllMachines now={now} /> : <MachineBlock card={selected} now={now} project={project} />
}

/** The hub's block over the machine's accounts: the hub's launch levels as the machine takes them, its accounts' drawer. */
function MachineBlock({ card, now, project }: { card: MachineCard; now: Date; project?: string }) {
  const rows = useMachineRows(card, project)
  if (rows === null) return null
  const shared = [{ account: rows.hub.active, source: 'shared' as const }]
  const levels = machineLevels((project === undefined ? undefined : rows.hub.headerLevels?.[project]) ?? shared, rows)
  return <AccountBlock account={rows.view} limits={null} now={now} levels={levels.length > 0 ? levels : [{ account: rows.view.active, source: 'shared' }]} machine={rows} />
}

/** "All machines": pointing shows a block per account, pressing opens the hub's narrow accounts drawer (BTN-1669). */
function AllMachines({ now }: { now: Date }) {
  const { cards } = useMachineFilter()
  const { state } = useLive()
  const { open, setOpen, rootRef } = usePopover()
  const blocks = state === null ? [] : headerAccounts(cards, state.account)
  const label = t.machinePanel.view.accountsAll(blocks.length)
  return (
    <div className="queue-menu machine-accounts" ref={rootRef}>
      <button type="button" className="hblock account-block__toggle" aria-expanded={open} aria-controls="account-panel" aria-label={label}
        aria-describedby={open ? undefined : 'machine-accounts'} onClick={() => setOpen(!open)}>
        <AllToggle blocks={blocks} />
      </button>
      {!open && <div id="machine-accounts" className="account-card machine-accounts__card" role="tooltip"><AccountBlocks blocks={blocks} now={now} /></div>}
      {open && state !== null && <ViewAccountPanel account={state.account} card={null} onClose={() => setOpen(false)} />}
    </div>
  )
}

function AllToggle({ blocks }: { blocks: HeaderAccount[] }) {
  const { state } = useLive()
  return (
    <span className="hblock__seg machine-accounts__all">
      {t.machinePanel.view.accounts}
      <span className="machine-accounts__marks" aria-hidden="true">
        {blocks.map((block) => (
          <span key={block.id} className="machine-accounts__lamp" style={seriesStyle(block.entry === undefined || state === null ? null : entrySlot(state.account, block.entry))} />
        ))}
      </span>
    </span>
  )
}

/** "All machines": an account a block — its e-mail, its limits once, the machines it is signed in on. */
function AccountBlocks({ blocks, now }: { blocks: HeaderAccount[]; now: Date }) {
  const { state } = useLive()
  const view = t.machinePanel.view
  if (blocks.length === 0) return <p className="queue__empty">{view.accountsUnused}</p>
  return (
    <ul className="machine-accounts__list">
      {blocks.map((block) => (
        <li key={block.id} className="machine-accounts__row" style={seriesStyle(block.entry === undefined || state === null ? null : entrySlot(state.account, block.entry))}>
          <span className="machine-accounts__who">
            <AgentIcon agent={block.agent} />
            <span className="machine-accounts__dot" aria-hidden="true" />
            <span className="machine-accounts__email">{block.email ?? block.entry?.name ?? block.key}</span>
          </span>
          {block.limits !== null && <Limits limits={block.limits} now={now} bare />}
          <MachineLabels items={block.machines.map((machine) => ({
            id: machine.id, name: machine.name, color: machine.color, kind: machine.token ? 'token' : 'in',
            ...(machine.token && { tip: t.account.machineOnTokenTip(machine.name) }),
          }))} />
        </li>
      ))}
    </ul>
  )
}

/** Why a machine lists no account: none yet before its first snapshot, else none at all. */
export function machineAccountsNone(card: MachineCard, signIns: MachineSignIn[] | undefined): string {
  const view = t.machinePanel.view
  return !card.own && machineAccountsEmpty(card.id, signIns) === 'waiting' ? view.accountsNone : view.accountsEmpty(card.name)
}

/**
 * A machine elsewhere's accounts for the hub's blocks (BTN-1570): its view (`machineAccountView`), where it takes each
 * account over `project` or, without one, over each project it is on, and its "Sign in" through `machines/login`; every
 * sign-in runs on the machine, followed by `MachineLoginDialog`.
 */
export function useMachineRows(card: MachineCard, project?: string): MachineRows | null {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  if (state === null) return null
  const hub = state.account
  const signIns = state.machineSignIns
  const signIn = signIns?.find((each) => each.machine === card.id)
  const online = signIn?.online ?? card.online
  const busy = sending || machineLogin(signIns) !== undefined
  const accounts = machineAccountView(hub, card, signIn)
  const projects = project === undefined ? card.projects.filter((each) => each.enabled).map((each) => each.project) : [project]
  const levels = Object.fromEntries(projects.map((each) => [each, hub.headerLevels?.[each] ?? [{ account: hub.active, source: 'shared' as const }]]))
  return {
    ...accounts,
    card,
    hub,
    uses: machineUses(levels, accounts),
    busy,
    online,
    addOff: busy || !online || hub.login != null,
    failure,
    send: machineSend(send, card.id, accounts.folders),
    switchOff: machineSwitchOff(accounts, card),
    signIn: (away) => {
      if (away.global === undefined && away.why === 'out' && away.account !== undefined) {
        return <FolderSignIn machine={{ id: card.id, name: card.name, online }} agent={away.agent} folder={away.account} way={away.way} busy={busy}
          noCli={away.noCli ? agentLabel(away.agent) : null} send={send} />
      }
      const [name, body] = gapCommand(away.agent, { machine: card.id, name: card.name, online, noCli: away.noCli, ...(away.account !== undefined && { account: away.account }), ...(away.global !== undefined && { global: away.global }) })
      return <SignIn name={card.name} online={online} busy={busy} noCli={away.noCli ? agentLabel(away.agent) : null} global={away.global !== undefined} onClick={() => void send(name, body)} />
    },
  }
}

/**
 * "Sign in" on the machine: greyed with why while it is off the link; without the agent's CLI there, what to install
 * instead. `global` — "Use it": the machine's CLI folder already signed in as the account is added (BTN-1568).
 */
export function SignIn({ name, online, busy, noCli, global = false, onClick }: { name: string; online: boolean; busy: boolean; noCli: string | null; global?: boolean; onClick: () => void }) {
  if (noCli !== null) return <span className="machine-accounts__end machine-accounts__muted">{t.machines.noCli(noCli)}</span>
  const label = global ? t.machinePanel.view.useGlobal : t.account.login
  return (
    <span className="machine-accounts__end">
      {online ? (
        global ? (
          <Tipped tip={t.machinePanel.view.useGlobalTip(name)} align="end">
            <button type="button" className="button button--small" disabled={busy} onClick={onClick}>
              {label}
            </button>
          </Tipped>
        ) : (
          <button type="button" className="button button--small" disabled={busy} onClick={onClick}>
            {label}
          </button>
        )
      ) : (
        <Tipped tip={t.machines.offlineTip(name)} align="end">
          <button type="button" className="button button--small" aria-disabled="true">
            {label}
          </button>
        </Tipped>
      )}
    </span>
  )
}
