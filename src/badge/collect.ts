import type { EvenKeelState, SessionView } from '../state.js'
import type { Task } from '../tracker/model.js'
import { localDay, localStamp } from './dates.js'
import { STATUS_FRESH_MS } from './status.js'
import { BADGE_FIELDS, BADGE_VERSION, type BadgeAction, type BadgeChain, type BadgeField, type BadgeState, type BadgeStats, type BadgeTask } from './model.js'

const DONE_CHIPS = 5
const QUEUED_CHIPS = 12
const DAY_MS = 86_400_000
/** The agent's pace is counted over this many last days. */
const PACE_DAYS = 7

/** A task of the project the chain ran and saw closed, from its archive (`closed_tasks`). */
export interface BadgeClosed {
  task: string
  closedAt: string
}

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
  /** The project's tasks the chain closed, with the time (BTN-970); none — no chip has a time and there is no forecast. */
  closed?: readonly BadgeClosed[]
  /** The zone the badge's dates and times are written in: the service's own by default. */
  tz?: string
}

/** The project's badge state from the service's state (BTN-915): only what `fields` picks, never a task's own title. */
export function badgeStateOf(state: EvenKeelState, project: string, inputs: BadgeInputs): BadgeState {
  const on = new Set(inputs.fields)
  const key = state.projectKeys[project] ?? project
  const tasks = state.tasks.filter((task) => task.project === project)
  const chains = state.chain.active.filter((chain) => chain.project === project)
  const active = chains.flatMap((chain) => (chain.current === null ? [] : [taskOf(state, chain.current, on, inputs)]))
  const order = state.chain.projects[project]?.order ?? []
  const working = new Set(active.map((task) => task.key))
  const next = order.find((id) => !working.has(id)) ?? null
  const chain: BadgeChain = { state: chains.length === 0 ? 'stopped' : chains.every((each) => each.paused) ? 'paused' : active.length === 0 ? 'idle' : 'running', next }
  const tz = inputs.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const closed = inputs.closed ?? []
  if (on.has('chain')) chain.tasks = chipsOf(tasks, active, order, closed, tz)
  const result: BadgeState = { v: BADGE_VERSION, at: inputs.now.toISOString(), project: { key, name: state.config.projects[project]?.name ?? key }, active, chain }
  const anchor = active[0]?.key ?? next ?? lastClosed(tasks, closed)
  if (on.has('milestone')) result.milestone = milestoneOf(tasks, anchor, new Set([...order, ...working]), { closed, tz, now: inputs.now })
  const stats = statsOf(inputs.stats, on)
  if (stats !== null) result.stats = stats
  return result
}

/** Every field: what a project publishes until its settings pick (BTN-917). */
export const ALL_BADGE_FIELDS: readonly BadgeField[] = BADGE_FIELDS

type Current = NonNullable<EvenKeelState['chain']['active'][number]['current']>

/**
 * A task on a spent limit (BTN-969) says only that and when the limit resets: no action, since the session makes no
 * call, and nothing of the account. The chain going on earlier, on another account, is plain work again.
 */
function taskOf(state: EvenKeelState, current: Current, on: Set<BadgeField>, inputs: BadgeInputs): BadgeTask {
  const { titleEn } = inputs
  const { task: id, since } = current
  const session = state.sessions.find((each) => each.sessionId === current.sessionId) ?? state.sessions.find((each) => each.task === id)
  const hold = current.limit !== undefined && current.limit.acted === null && current.limit.transient !== true ? current.limit : undefined
  const limited = hold !== undefined || session?.lamp === 'limit'
  const waiting = session !== undefined && (session.asking || session.lamp === 'waiting')
  const task: BadgeTask = { key: id, state: limited ? 'limit' : waiting ? 'waiting' : 'working' }
  if (hold !== undefined && hold.resetsAt !== null) task.until = hold.resetsAt
  const title = on.has('title') ? titleEn?.(id) : undefined
  if (title !== undefined && title.trim() !== '') task.titleEn = title.trim()
  if (session === undefined) {
    if (on.has('time')) task.startedAt = since
    return task
  }
  if (on.has('agent')) task.agent = session.agent
  if (on.has('model') && session.model !== null) task.model = session.model
  if (on.has('time')) task.startedAt = since
  if (on.has('action') && !limited) task.action = withStatus(actionOf(session), session, inputs)
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

/**
 * The last done tasks by the time the chain closed them (BTN-970), written in the service's zone; one closed past the
 * chain has no time and stands before those that have, by its number.
 */
function chipsOf(tasks: Task[], active: BadgeTask[], order: string[], closed: readonly BadgeClosed[], tz: string): NonNullable<BadgeChain['tasks']> {
  const working = new Set(active.map((task) => task.key))
  const times = new Map(closed.flatMap((each) => (Number.isNaN(Date.parse(each.closedAt)) ? [] : [[each.task, Date.parse(each.closedAt)] as const])))
  const done = tasks
    .filter((task) => task.status.category === 'Won')
    .map((task) => task.id)
    .sort((a, b) => (times.get(a) ?? -Infinity) - (times.get(b) ?? -Infinity) || byNumber(a, b))
    .slice(-DONE_CHIPS)
  return [
    ...done.map((key) => {
      const at = times.get(key)
      return at === undefined ? { key, state: 'done' as const } : { key, state: 'done' as const, doneAt: localStamp(new Date(at), tz) }
    }),
    ...active.map((task) => ({ key: task.key, state: task.state })),
    ...order.filter((id) => !working.has(id)).slice(0, QUEUED_CHIPS).map((key) => ({ key, state: 'queued' as const })),
  ]
}

/**
 * The task of a milestone the chain closed last: what the milestone's card shows once the chain has nothing to take,
 * so an idle badge still tells the agent's part is done and the rest waits for the maintainer.
 */
function lastClosed(tasks: Task[], closed: readonly BadgeClosed[]): string | null {
  const known = new Set(tasks.filter((task) => task.milestone !== null && task.milestone !== undefined).map((task) => task.id))
  let last: { task: string; at: number } | null = null
  for (const each of closed) {
    const at = Date.parse(each.closedAt)
    if (known.has(each.task) && !Number.isNaN(at) && (last === null || at > last.at)) last = { task: each.task, at }
  }
  return last?.task ?? null
}

/**
 * The milestone of `anchor` (BTN-970): its done tasks, the open ones, and those of them the chain takes — `queue`, the
 * chain's own order and the tasks in work. The forecast is the queue over the chain's pace of the last 7 days.
 */
function milestoneOf(tasks: Task[], anchor: string | null, queue: Set<string>, when: { closed: readonly BadgeClosed[]; tz: string; now: Date }): BadgeState['milestone'] {
  const milestone = tasks.find((task) => task.id === anchor)?.milestone
  if (milestone === undefined || milestone === null) return null
  const of = tasks.filter((task) => task.milestone?.label === milestone.label)
  const open = of.filter((task) => task.status.category !== 'Won' && task.status.category !== 'Lost')
  const queued = open.filter((task) => queue.has(task.id)).length
  const result: NonNullable<BadgeState['milestone']> = { name: milestone.label, done: of.filter((task) => task.status.category === 'Won').length, left: open.length, queued }
  const now = when.now.getTime()
  const recent = when.closed.filter((each) => {
    const age = now - Date.parse(each.closedAt)
    return age >= 0 && age <= PACE_DAYS * DAY_MS
  }).length
  if (queued > 0 && recent > 0) result.eta = localDay(new Date(now + (queued / (recent / PACE_DAYS)) * DAY_MS), when.tz)
  if (milestone.targetDate) result.target = localDay(new Date(milestone.targetDate), when.tz)
  return result
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
