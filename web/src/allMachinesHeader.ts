import type { AccountLevel } from '../../src/account/header-levels.js'
import type { AccountView } from '../../src/account/model.js'
import type { EvenKeelState, MachineCard, SessionView } from '../../src/state.js'
import { poolOf } from './machineView.js'
import { machineMarks, sameEmail } from './machineSignIn.js'

export type AllMachinesView = Pick<EvenKeelState, 'account' | 'chain' | 'sessions' | 'ownMachine'>

/** A lane of the project with a live session: the task, the machine it runs on and the session. */
interface LiveRun {
  task: string
  machine: string | undefined
  session: SessionView
}

function liveRuns(state: AllMachinesView, project: string): LiveRun[] {
  return state.chain.active.flatMap((lane) => {
    const id = lane.project === project ? lane.current?.sessionId : null
    const session = id == null ? undefined : state.sessions.find((each) => each.sessionId === id)
    return session === undefined ? [] : [{ task: lane.current!.task, machine: lane.machine || state.ownMachine, session }]
  })
}

/** The hub's folder of a session's account: of its agent, by the e-mail it ran as, or the folder the e-mail names. */
function hubFolder(view: AccountView, session: SessionView): string | undefined {
  const named = view.accounts.filter((entry) => entry.agent === session.agent &&
    (sameEmail(entry.status?.email ?? entry.lastEmail ?? null, session.account) || entry.key === session.account))
  return (named.find((entry) => entry.longToken === undefined) ?? named[0])?.key
}

/**
 * The machines diverge (BTN-1805): the project's live sessions run on more than one machine and on more than one
 * account. Two machines and two accounts always give a pair of sessions that differ in both.
 */
function diverge(runs: LiveRun[]): boolean {
  const machines = new Set(runs.map((run) => run.machine))
  const accounts = new Set(runs.flatMap((run) => (run.session.account === null ? [] : [`${run.session.agent}:${run.session.account.toLowerCase()}`])))
  return machines.size > 1 && accounts.size > 1
}

/**
 * The header's levels in "All machines" (BTN-1805): the hub's, unless the machines diverge. Then the project and Even
 * Keel, under the account of the focused task's live session as the task level; without such a task, those two alone.
 * Outside a project the block takes Even Keel's account itself.
 */
export function allMachinesLevels(state: AllMachinesView, project: string | undefined, focus: string): AccountLevel[] | undefined {
  if (project === undefined) return undefined
  const hub = state.account.headerLevels?.[project] ?? [{ account: state.account.active, source: 'shared' }]
  const runs = liveRuns(state, project)
  if (!diverge(runs)) return hub
  const inherited = state.account.inheritedLevels?.[project] ?? hub.filter((level) => level.source !== 'task')
  const run = runs.find((each) => each.task === focus)
  const account = run === undefined ? undefined : hubFolder(state.account, run.session)
  if (account === undefined) return inherited
  const levels: AccountLevel[] = [{ account, source: 'task', task: focus }, ...inherited]
  return levels.filter((each, index) => levels.findIndex((other) => other.account === each.account) === index)
}

/** The machines of the project's pool (any machine, outside a project) where the hub's account is signed out. */
export function accountOutOn(state: Pick<EvenKeelState, 'account' | 'machineSignIns'>, cards: readonly MachineCard[], project: string | undefined, account: string): string[] {
  const entry = state.account.accounts.find((each) => each.key === account)
  if (entry === undefined) return []
  const pool = new Set((project === undefined ? cards : poolOf(cards, project)).map((card) => card.id))
  return machineMarks(entry, state.account.accounts, state.machineSignIns)
    .filter((mark) => mark.kind === 'out' && pool.has(mark.machine))
    .map((mark) => mark.name)
}
