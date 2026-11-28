import { useLocation } from 'react-router'
import type { MachineCard, MachineSignIn } from '../../../src/state.js'
import { accountOutOn, allMachinesLevels } from '../allMachinesHeader.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { machineAccountsEmpty } from '../machineAdd.js'
import { machineAccountView, machineLevels, machineUses } from '../machineAccountView.js'
import { gapCommand, machineLogin } from '../machineSignIn.js'
import { Tipped } from '../ui/Tipped.js'
import { AccountBlock } from './AccountBlock.js'
import { agentLabel } from '../accountName.js'
import { FolderSignIn } from './MachineFolderSignIn.js'
import { useMachineFilter } from './MachineFilter.js'
import { machineSend, machineSwitchOff, type MachineRows } from './machineRows.js'
import './machineAccounts.css'

/**
 * The header's accounts block in a machine's view: a machine elsewhere's is the hub's own block over its accounts
 * (BTN-1570); "All machines" the hub's block too (BTN-1805). The own machine's view keeps the hub's own block (`AccountBlock`).
 */
export function MachineAccountsBlock({ now, project }: { now: Date; project?: string }) {
  const { selected } = useMachineFilter()
  return selected === null ? <AllMachines now={now} project={project} /> : <MachineBlock card={selected} now={now} project={project} />
}

/** The hub's block over the machine's accounts: the hub's launch levels as the machine takes them, its accounts' drawer. */
function MachineBlock({ card, now, project }: { card: MachineCard; now: Date; project?: string }) {
  const rows = useMachineRows(card, project)
  if (rows === null) return null
  const shared = [{ account: rows.hub.active, source: 'shared' as const }]
  const levels = machineLevels((project === undefined ? undefined : rows.hub.headerLevels?.[project]) ?? shared, rows)
  return <AccountBlock account={rows.view} limits={null} now={now} levels={levels.length > 0 ? levels : [{ account: rows.view.active, source: 'shared' }]} machine={rows} />
}

/**
 * "All machines" (BTN-1805): the hub's block, its levels as the hub's view has them unless the machines run the project
 * on different accounts (`allMachinesLevels`), with a lamp where the shown account is signed out on a machine.
 */
function AllMachines({ now, project }: { now: Date; project?: string }) {
  const { cards } = useMachineFilter()
  const { state } = useLive()
  const focus = decodeURIComponent(useLocation().hash.slice(1))
  if (state === null) return null
  const levels = allMachinesLevels(state, project, focus)
  const out = accountOutOn(state, cards, project, levels?.[0]?.account ?? state.account.active)
  return <AccountBlock account={state.account} limits={state.limits} now={now} levels={levels} out={out} />
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
