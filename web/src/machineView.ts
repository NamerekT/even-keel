import { nextTask } from '../../src/chain/order.js'
import type { EvenKeelState, MachineCard } from '../../src/state.js'
import type { Task } from '../../src/tracker/model.js'
import { isCarryName, isFixName } from '../../src/chain/fix.js'
import type { ChainBlock } from './state.js'

/** The address parameter of the machine whose view the page shows (BTN-1051); none — every machine. */
export const MACHINE_PARAM = 'machine'

/** The lamp of a machine's card, in the order the card is judged by. */
export type MachineLamp = 'offline' | 'working' | 'blocked' | 'limit' | 'free'

/** What a card of the machines panel says under the machine's name. */
export interface MachineState {
  lamp: MachineLamp
  /** `working` — the task it runs; `free` — the task it would take next, a guess by pull, not a promise. */
  task?: { id: string; title: string | null }
  /** `limit` — when the first of its accounts frees. */
  until?: string
  /** `blocked` — why it takes no task. */
  reason?: 'git' | 'packages' | 'version'
  /** `blocked` by `version` — Even Keel's version the machine runs. */
  version?: string
  /** `offline` — since when, as the hub saw it go; `null` — not seen since the hub started. */
  since?: number | null
}

type View = Pick<EvenKeelState, 'chain' | 'tasks' | 'runs' | 'config' | 'ownMachine' | 'taskSessions'>

/** The machines that take a project's tasks: those with its row turned on; none — the own machine alone, as before pools. */
export function poolOf(cards: readonly MachineCard[], project: string): MachineCard[] {
  const pool = cards.filter((card) => card.projects.some((row) => row.project === project && row.enabled))
  return pool.length > 0 ? pool : cards.filter((card) => card.own)
}

/** The provider a task's sessions run on: its run's, else its project's, else the shared one. */
export function providerOf(state: Pick<EvenKeelState, 'runs' | 'config'>, project: string, task: string | null): string {
  const run = task === null ? undefined : state.runs[project]?.[task]
  return run?.provider ?? state.config.projects[project]?.provider ?? state.config.shared.provider
}

/** Whether a machine may run a provider's task: it has an account of it, or no machine of the pool has one. */
export function mayRun(card: MachineCard, provider: string, pool: readonly MachineCard[]): boolean {
  return card.agents.includes(provider) || !pool.some((each) => each.agents.includes(provider))
}

/** The lanes a machine runs; a lane without a machine is the own machine's. */
export function lanesOfMachine(state: Pick<EvenKeelState, 'chain'>, card: MachineCard) {
  return state.chain.active.filter((lane) => (lane.machine === undefined || lane.machine === '' ? card.own : lane.machine === card.id))
}

const titleOf = (state: Pick<EvenKeelState, 'tasks'>, project: string, id: string): string | null =>
  state.tasks.find((task) => task.project === project && task.id === id)?.title ?? null

/**
 * The state of a machine's card. On a project's page it is judged for that project; elsewhere for the projects its
 * pool has, those with a lane first, then the queue's.
 */
export function machineState(state: View, cards: readonly MachineCard[], card: MachineCard, project?: string): MachineState {
  if (!card.online) return { lamp: 'offline', since: card.offlineSince }
  const lanes = lanesOfMachine(state, card).filter((lane) => lane.current !== null && (project === undefined || lane.project === project))
  const running = lanes[0]?.current
  if (running) return { lamp: 'working', task: { id: running.task, title: titleOf(state, lanes[0]!.project, running.task) } }
  if (card.otherVersion !== undefined) return { lamp: 'blocked', reason: 'version', version: card.otherVersion }
  if (card.gitUser === false) return { lamp: 'blocked', reason: 'git' }
  const projects = projectsOf(state, cards, card, project)
  if (project !== undefined && card.projects.some((row) => row.project === project && row.packagesBlocked)) return { lamp: 'blocked', reason: 'packages' }
  const limited = projects.map((each) => card.limitedUntil[providerOf(state, each, null)]).find((until) => until !== undefined)
  if (limited !== undefined) return { lamp: 'limit', until: limited }
  for (const each of projects) {
    const next = nextOf(state, cards, card, each)
    if (next !== undefined) return { lamp: 'free', task: { id: next, title: titleOf(state, each, next) } }
  }
  return { lamp: 'free' }
}

function projectsOf(state: View, cards: readonly MachineCard[], card: MachineCard, project: string | undefined): string[] {
  if (project !== undefined) return [project]
  const named = [...state.chain.active.map((lane) => lane.project), ...state.chain.queue]
  return [...new Set(named)].filter((each) => poolOf(cards, each).some((member) => member.id === card.id))
}

/** The task the machine would take next in a project: the first of the order nothing holds, of a provider it runs. */
function nextOf(state: View, cards: readonly MachineCard[], card: MachineCard, project: string): string | undefined {
  const order = state.chain.projects[project]
  if (order === undefined) return undefined
  const pool = poolOf(cards, project)
  const held = new Set(state.chain.active.filter((lane) => lane.project === project).flatMap((lane) => (lane.current === null ? [] : [lane.current.task])))
  const refused = order.order.filter((id) => !mayRun(card, providerOf(state, project, id), pool))
  const own = cards.find((each) => each.own)?.id
  const elsewhere = order.order.filter((id) => {
    const last = state.taskSessions[id]?.at(-1)
    return last !== undefined && (last.machine ?? own) !== card.id
  })
  const tasks: Task[] = state.tasks.filter((task) => task.project === project)
  return nextTask(tasks, order.order, [...(state.chain.skipped[project] ?? []), ...order.waiting, ...held, ...refused, ...elsewhere])
}

/**
 * The chain as a machine's view shows it: without the tasks another machine runs or ran last, the fixes of main elsewhere than
 * on the own machine and the tasks it may not take; no machine tags, since all of it is one machine's.
 */
export function machineChain(blocks: readonly ChainBlock[], state: Pick<EvenKeelState, 'runs' | 'config'>, cards: readonly MachineCard[], project: string, machine: string): ChainBlock[] {
  const card = cards.find((each) => each.id === machine)
  if (card === undefined) return [...blocks]
  const pool = poolOf(cards, project)
  const pooled = pool.some((each) => each.id === machine)
  const own = cards.find((each) => each.own)?.id
  return blocks.flatMap((block) => {
    // A session without a machine ran on the hub's own one: `taskMachines` tags only the others.
    const last = block.machines?.at(-1)?.id ?? (block.current || block.sessions.length > 0 ? own : undefined)
    if (block.fix !== undefined || isFixName(block.id) || isCarryName(block.id)) return card.own ? [untagged(block)] : []
    if (last !== undefined) return last === machine ? [untagged(block)] : []
    const open = block.open || block.locked
    if (open && (!pooled || !mayRun(card, block.run?.provider ?? providerOf(state, project, null), pool))) return []
    return [untagged(block)]
  })
}

/** The backlog's tasks a machine could take: none where it is out of the project's pool. */
export function machineBacklog<T extends { id: string }>(tasks: readonly T[], state: Pick<EvenKeelState, 'runs' | 'config'>, cards: readonly MachineCard[], project: string, machine: string): T[] {
  const card = cards.find((each) => each.id === machine)
  if (card === undefined) return [...tasks]
  const pool = poolOf(cards, project)
  if (!pool.some((each) => each.id === machine)) return []
  return tasks.filter((task) => mayRun(card, providerOf(state, project, task.id), pool))
}

/** The projects a machine's view shows (BTN-1279): those whose pool has it, turned off too; on the own machine also those without a pool. */
export function machineProjects(cards: readonly MachineCard[], projects: readonly string[], machine: string): string[] {
  const card = cards.find((each) => each.id === machine)
  if (card === undefined) return [...projects]
  return projects.filter((project) => card.projects.some((row) => row.project === project) || poolOf(cards, project).some((each) => each.id === machine))
}

/**
 * The state the header reads in a machine's view (BTN-1279): its lanes, the queue of its projects and the sessions of the
 * tasks it runs or ran last; a lane or a session without a machine is the own machine's.
 */
export function machineHeader(state: EvenKeelState, cards: readonly MachineCard[], machine: string): EvenKeelState {
  const card = cards.find((each) => each.id === machine)
  if (card === undefined) return state
  const own = cards.find((each) => each.own)?.id
  const lanes = lanesOfMachine(state, card)
  const machineOf = (task: string): string | undefined => {
    const lane = state.chain.active.find((each) => each.current?.task === task)
    if (lane !== undefined) return lane.machine || own
    return state.taskSessions[task]?.at(-1)?.machine ?? own
  }
  const projects = new Set(machineProjects(cards, state.chain.queue, machine))
  return {
    ...state,
    chain: { ...state.chain, active: lanes, queue: state.chain.queue.filter((project) => projects.has(project)) },
    sessions: state.sessions.filter((session) => machineOf(session.task) === machine),
  }
}

/** The header block's count (BTN-1310): the number of machines, or "online/all" with the names of those off the link. */
export function machineCount(cards: readonly MachineCard[]): { text: string; away: string[] } {
  const away = cards.filter((card) => !card.online).map((card) => card.name)
  return { text: away.length === 0 ? `${cards.length}` : `${cards.length - away.length}/${cards.length}`, away }
}

/** The whole queue after a machine's view reordered its projects: they take the places they held, in the new order. */
export function mergeQueue(full: readonly string[], order: readonly string[]): string[] {
  const named = new Set(order)
  let next = 0
  return full.map((project) => (named.has(project) ? order[next++]! : project))
}

function untagged(block: ChainBlock): ChainBlock {
  if (block.machines === undefined) return block
  const { machines: _machines, ...rest } = block
  return rest
}
