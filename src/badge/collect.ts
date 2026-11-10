import type { EvenKeelState, SessionView } from '../state.js'
import type { Task } from '../tracker/model.js'
import { STATUS_FRESH_MS } from './status.js'
import { BADGE_FIELDS, BADGE_VERSION, type BadgeAction, type BadgeChain, type BadgeField, type BadgeState, type BadgeStats, type BadgeTask } from './model.js'

const DONE_CHIPS = 5
const QUEUED_CHIPS = 12

export interface BadgeInputs {
  now: Date
  /** The fields to publish; the rest leave no key. */
  fields: readonly BadgeField[]
  /** The project's numbers from the stats; `null` — none to show. */
  stats: BadgeStats | null
  /** A task's title in English (BTN-918); none — the badge shows only its key. */
  titleEn?: (task: string) => string | undefined
  /** Whether a session's own status line may be published (the filter of private data); none — every line may. */
  statusOk?: (text: string) => boolean
}

/** The project's badge state from the service's state (BTN-915): only what `fields` picks, never a task's own title. */
export function badgeStateOf(state: EvenKeelState, project: string, inputs: BadgeInputs): BadgeState {
  const on = new Set(inputs.fields)
  const key = state.projectKeys[project] ?? project
  const tasks = state.tasks.filter((task) => task.project === project)
  const chains = state.chain.active.filter((chain) => chain.project === project)
  const active = chains.flatMap((chain) => (chain.current === null ? [] : [taskOf(state, chain.current.task, chain.current.sessionId, chain.current.since, on, inputs)]))
  const order = state.chain.projects[project]?.order ?? []
  const working = new Set(active.map((task) => task.key))
  const next = order.find((id) => !working.has(id)) ?? null
  const chain: BadgeChain = { state: chains.length === 0 ? 'stopped' : chains.every((each) => each.paused) ? 'paused' : active.length === 0 ? 'idle' : 'running', next }
  if (on.has('chain')) chain.tasks = chipsOf(tasks, active, order)
  const result: BadgeState = { v: BADGE_VERSION, at: inputs.now.toISOString(), project: { key, name: state.config.projects[project]?.name ?? key }, active, chain }
  if (on.has('milestone')) result.milestone = milestoneOf(tasks, active[0]?.key ?? next)
  const stats = statsOf(inputs.stats, on)
  if (stats !== null) result.stats = stats
  return result
}

/** Every field: what a project publishes until its settings pick (BTN-917). */
export const ALL_BADGE_FIELDS: readonly BadgeField[] = BADGE_FIELDS

function taskOf(state: EvenKeelState, id: string, sessionId: string | null, since: string, on: Set<BadgeField>, inputs: BadgeInputs): BadgeTask {
  const { titleEn } = inputs
  const session = state.sessions.find((each) => each.sessionId === sessionId) ?? state.sessions.find((each) => each.task === id)
  const waiting = session !== undefined && (session.asking || session.lamp === 'waiting')
  const task: BadgeTask = { key: id, state: waiting ? 'waiting' : 'working' }
  const title = on.has('title') ? titleEn?.(id) : undefined
  if (title !== undefined && title.trim() !== '') task.titleEn = title.trim()
  if (session === undefined) {
    if (on.has('time')) task.startedAt = since
    return task
  }
  if (on.has('agent')) task.agent = session.agent
  if (on.has('model') && session.model !== null) task.model = session.model
  if (on.has('time')) task.startedAt = since
  if (on.has('action')) task.action = withStatus(actionOf(session), session, inputs)
  if (on.has('context')) {
    const window = session.contextWindow ?? state.context.window
    task.context = window > 0 ? Math.min(100, Math.round((session.contextTokens / window) * 100)) : 0
  }
  return task
}

/** The session's latest tool call as the badge may show it; a line of an agent without `badge` shows only its tool. */
function actionOf(session: SessionView): BadgeAction | null {
  const lines = session.action === null ? session.feed : [...session.feed, session.action]
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!
    if (line.kind !== 'tool') continue
    if (line.badge !== undefined) return line.badge
    const tool = line.text.split(' ', 1)[0] ?? ''
    return tool === '' ? null : { tool, text: tool }
  }
  return null
}

/**
 * The session's own status line in place of the action's text (BTN-932), while it is fresh and may be published; else
 * the action as it is. The tool stays for the icon.
 */
function withStatus(action: BadgeAction | null, session: SessionView, inputs: BadgeInputs): BadgeAction | null {
  const status = session.badgeStatus
  if (action === null || status === undefined || status === null) return action
  const age = inputs.now.getTime() - Date.parse(status.at)
  if (!(age < STATUS_FRESH_MS)) return action
  if (inputs.statusOk !== undefined && !inputs.statusOk(status.text)) return action
  return { tool: action.tool, text: status.text }
}

function chipsOf(tasks: Task[], active: BadgeTask[], order: string[]): { key: string; state: 'done' | 'working' | 'waiting' | 'queued' }[] {
  const working = new Set(active.map((task) => task.key))
  const done = tasks
    .filter((task) => task.status.category === 'Won')
    .map((task) => task.id)
    .sort(byNumber)
    .slice(-DONE_CHIPS)
  return [
    ...done.map((key) => ({ key, state: 'done' as const })),
    ...active.map((task) => ({ key: task.key, state: task.state })),
    ...order.filter((id) => !working.has(id)).slice(0, QUEUED_CHIPS).map((key) => ({ key, state: 'queued' as const })),
  ]
}

function milestoneOf(tasks: Task[], anchor: string | null): BadgeState['milestone'] {
  const label = tasks.find((task) => task.id === anchor)?.milestone?.label
  if (label === undefined) return null
  const of = tasks.filter((task) => task.milestone?.label === label)
  const done = of.filter((task) => task.status.category === 'Won').length
  const left = of.filter((task) => task.status.category !== 'Won' && task.status.category !== 'Lost').length
  return { name: label, done, left }
}

function statsOf(stats: BadgeStats | null, on: Set<BadgeField>): BadgeStats | null {
  if (stats === null) return null
  const result: BadgeStats = {}
  if (on.has('sessions') && stats.sessions !== undefined) result.sessions = stats.sessions
  if (on.has('medianCost') && stats.medianCost !== undefined) result.medianCost = stats.medianCost
  if (on.has('medianMinutes') && stats.medianMinutes !== undefined) result.medianMinutes = stats.medianMinutes
  return Object.keys(result).length === 0 ? null : result
}

function byNumber(a: string, b: string): number {
  const number = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0)
  return number(a) - number(b) || a.localeCompare(b)
}
