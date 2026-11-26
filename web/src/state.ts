import { idleBeforePrompt } from '../../src/sessions/boot.js'
import { projectLabel, projectPath } from './projectLookup.js'
import { chatHandover, sessionStart, type ChatHandover, type SessionStart } from './sessionStart.js'
export { idleBeforePrompt } from '../../src/sessions/boot.js'
export { keySlots, ownProjects, projectLabel, projectName, projectOfPath, projectPages, projectPath, projectSlot, projectSlots, projectTracker, trackerTitle, type TrackerPage } from './projectLookup.js'
export { chatHandover, sessionStart, type ChatHandover, type SessionStart, type StartPhase } from './sessionStart.js'
export { accountBadge, entryBadge, headerAccounts, loginLeft, loginEndsFrom, loginWindowTip, limitedUntil, canWork, accountOrder, type AccountBadge } from './account-state.js'
import type { ActiveChain, CurrentTask, ProjectOrder, ReviewView } from '../../src/chain/dispatcher.js'
import { fixNameOf, fixTaskOf, isCarryName, isFixName, isOwnName, liveFixId, projectOfFix, releaseOfCarry } from '../../src/chain/fix.js'
import type { FixEpisode, TaskSession } from '../../src/chain/launches.js'
import { ancestorsOf, chainOrder, nextTask, precedence, withWaiting } from '../../src/chain/order.js'
import type { LimitSpent } from '../../src/chain/limitNotice.js'
import type { LimitHold } from '../../src/chain/relay.js'
import { PROJECT_COLORS } from '../../src/projects/colors.js'
import { isOpen, type StatusCategory, type Task, type TaskPriority } from '../../src/tracker/model.js'
import type { TaskRun } from '../../src/sessions/runs.js'
import type { Lamp } from '../../src/sessions/agents.js'
import type { CacheTtl, CacheWindow, TokenTotals } from '../../src/sessions/transcript.js'
import type { UsageHealth } from '../../src/limits/usage.js'
import { notice, type Notice } from '../../src/notice/notice.js'
import type { ActiveChainView, EvenKeelState, ContextScale, PinWait, ProjectTask, SessionView, TaskWork, TrackerUrls } from '../../src/state.js'
import { formatMoment } from './format.js'
import { say, t } from './i18n/index.js'
import { shownWork } from '../../src/shown-work.js'
import { limitHeld, taskLamp } from './taskLamp.js'
import { completionTasks, needsReply } from './completion.js'
import { laneOfTask, lanesOf, pinnedMachines, taskMachines, type TaskMachine } from './lanes.js'

type CiWait = NonNullable<ActiveChain['ciWait']>
type LimitsWait = NonNullable<ActiveChain['limitsWait']>

export type ChainStatus =
  | { kind: 'running'; limitUntil: string | null; slotWait?: Notice; ciWait?: CiWait; limitsWait?: LimitsWait }
  | { kind: 'paused'; error: Notice | null }
  | { kind: 'queued'; position: number }
  | { kind: 'idle' }

export interface CardTask {
  id: string
  title: string | null
  lamp: BlockLamp
  next: boolean
  /** Every open task is held and this is the first of them: skipped, or waiting on a blocker the chain does not take. */
  held?: 'skipped' | 'blocked'
}

/**
 * The lamp of a task, the same wherever the task shows: `handoff` — its session ended on a checkpoint nobody took up;
 * `fixed` — a fix of a red main that is over, landed or dropped.
 */
export type BlockLamp = 'done' | 'working' | 'waiting' | 'handoff' | 'stopped' | 'error' | 'limit' | 'ahead' | 'backlog' | 'canceled' | 'fixed'

/** A row that is over and goes to the archive: a closed task or a fix of main that ended. */
export function isClosedLamp(lamp: BlockLamp): boolean {
  return lamp === 'done' || lamp === 'canceled' || lamp === 'fixed'
}

export interface ChainBlock {
  id: string
  title: string | null
  status: string | null
  stage: StatusCategory | null
  lamp: BlockLamp
  open: boolean
  locked: boolean
  blockedBy: string[]
  milestone: string | null
  after: string[]
  current: boolean
  skipped: boolean
  question: boolean
  priority: TaskPriority
  estimate: number | null
  parent: string | null
  /** Its open parents, `ancestorsOf` the task: a waiting parent's row follows its last subtask (`withWaiting`); absent — none. */
  ancestors?: readonly string[]
  labels: string[]
  /** What the task's sessions run on where its card set it (`state.runs`); `null` — as the project says. */
  run: TaskRun | null
  session: SessionView | null
  sessions: TaskSession[]
  limit: LimitHold | null
  /** The current task's account has its limit spent until then: "New session" is held (BTN-1359); absent — a window is free. */
  spent?: LimitSpent
  start: SessionStart | null
  /** "New session with this message" on its way, for the chat (BTN-1281); absent — none. */
  handover?: ChatHandover
  /** Since when the chain is delivering the user's answer to the task's session: stopping it and resuming it with the answer. */
  answering?: string
  /** The machines it ran on, oldest first, its lane's now last (`taskMachines`); absent — one machine. */
  machines?: TaskMachine[]
  /** `machines` are the ones its run pins it to, not those it ran on (BTN-1623): it has run nowhere yet. */
  pinned?: true
  /** Why the task pinned to machines waits, and the names of its machines (`state.pinWaits`); absent — it waits for none. */
  pinWait?: { why: PinWait; machines: string[] }
  /** A machine gone holds the task (BTN-1270): its name, and whether the task's branch is on the remote so it can move. */
  stranded?: { machine: string; pushed: boolean | null }
  /** A red main stopped the task's session; it goes on once main is fixed. */
  interrupted?: true
  /**
   * The current task of a paused lane whose session does not run, as the one a red after the fix gave back (BTN-1617):
   * it is not under way, and stands under the running group.
   */
  halted?: true
  /** The fix of a red main leads the chain and this task is next: its live session takes no answer from the chat until the fix lands. */
  aside?: true
  /** The chain is stopped and the task's session lives on: the chat still answers it. */
  loose?: true
  /** The row of a fix of a red main that is over. */
  fix?: FixEpisode
  /** The task is out of the chain, waiting on its pull request. */
  review?: ReviewView
  /**
   * Work in the task's folder that is in no commit of main (BTN-298), once the task is out of the chain and no session of
   * it works: skipped, waiting on its pull request with files left out of a commit, or closed and cleaned up after (BTN-332).
   */
  work?: TaskWork
  /** What the cleanup after the closed task said; the row keeps it in view until the user dismisses it. */
  leftovers?: Notice[]
  /** A row of the "Parents" view (BTN-1041): how many of its subtasks are closed, of how many. */
  subtasks?: { closed: number; total: number }
}

export type ContextLevel = 'ok' | 'warn' | 'danger'

export const PROJECT_SLOTS = PROJECT_COLORS

const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

export function projectTasks(state: Pick<EvenKeelState, 'tasks'>, project: string): ProjectTask[] {
  return state.tasks.filter((task) => task.project === project)
}

export function waitingSessions(sessions: SessionView[], tasks: Task[], refused: ReadonlySet<string> = new Set(), now = new Date()): SessionView[] {
  const open = new Set(tasks.filter((task) => isOpen(task.status)).map((task) => task.id))
  const since = (view: SessionView) => Date.parse(view.lastActivityAt ?? view.startedAt)
  return sessions
    .filter((view) => view.lamp === 'waiting' && !idleBeforePrompt(view, now) && view.apiErrorKind !== 'transient' && !view.checkpoint && (open.has(view.task) || isOwnName(view.task)))
    .filter((view) => !refused.has(view.task) || needsReply(view))
    .sort((a, b) => since(a) - since(b))
}

export function blockMetered(block: Pick<ChainBlock, 'current' | 'session'>): boolean {
  return block.session !== null && (block.current || block.session.lamp !== 'finished')
}

export function checkpointHandoffs(rows: TaskSession[]): number {
  return rows.filter((row) => row.how === 'checkpoint').length
}

/** How many times a task's context started over: `limit` and `relay` — new sessions after the limit and for the other causes. */
export interface ContextResets {
  checkpoint: number
  limit: number
  relay: number
  restart: number
  compactions: number
  total: number
}

export function contextResets(rows: TaskSession[]): ContextResets {
  const resets = { checkpoint: 0, limit: 0, relay: 0, restart: 0, compactions: 0, total: 0 }
  for (const row of rows) {
    if (row.how === 'checkpoint' || row.how === 'restart') resets[row.how]++
    // A key out of credit is the API account's limit: counted with the limits.
    else if (row.how === 'relay') resets[row.cause === undefined || row.cause === 'limit' || row.cause === 'credit' ? 'limit' : 'relay']++
    resets.compactions += row.compactions ?? 0
  }
  resets.total = resets.checkpoint + resets.limit + resets.relay + resets.restart + resets.compactions
  return resets
}

/** The prefix of a task id or fix name: `ABC` of `ABC-12`. */
export function taskPrefix(task: string): string {
  return task.replace(/-(\d+|FIX|CARRY)$/, '')
}

type ProjectSource = Pick<EvenKeelState, 'tasks' | 'projectKeys' | 'taskPrefixes'> & Partial<Pick<EvenKeelState, 'forwards' | 'fixes' | 'config'>>

/** The title of a project's task as the poll lists it; `null` when the task is not listed (a closed parent). */
export function taskTitle(tasks: readonly ProjectTask[] | undefined, project: string, task: string): string | null {
  return tasks?.find((each) => each.project === project && each.id === task)?.title ?? null
}

/**
 * The project of a task or of a fix episode, by id (BTN-271): the one its fix name is of, the one a carry runs in, the
 * one listing the task, else the first with its prefix, else the owner of the feed with it (BTN-651); the prefix itself
 * when none has it.
 */
export function taskProject(state: ProjectSource | null, task: string): string {
  if (state === null) return taskPrefix(fixTaskOf(task))
  if (isFixName(task)) return projectOfFix(state.projectKeys, task) ?? taskPrefix(fixTaskOf(task))
  if (isCarryName(task)) return carryProject(state, task) ?? taskPrefix(fixTaskOf(task))
  const listed = state.tasks.find((each) => each.id === task)?.project
  if (listed !== undefined) return listed
  const prefix = taskPrefix(task)
  const feeds = state.config?.feeds ?? {}
  return (
    Object.keys(state.taskPrefixes).find((project) => state.taskPrefixes[project] === prefix) ??
    Object.keys(feeds).find((project) => feeds[project]!.some((feed) => (feed.prefix ?? feed.key) === prefix)) ??
    prefix
  )
}

/** The project a carry runs in (BTN-369): the one its release merges into, else the one its past episodes ran in. */
function carryProject(state: ProjectSource, task: string): string | undefined {
  const from = releaseOfCarry(state.projectKeys, task)
  const into = from === undefined ? undefined : state.forwards?.[from]?.into
  const name = fixTaskOf(task)
  return into ?? Object.keys(state.fixes ?? {}).find((project) => state.fixes![project]!.some((episode) => fixTaskOf(episode.id) === name))
}

/** The release project a carry is of, as the page names it. */
function carryLabel(state: Pick<EvenKeelState, 'projectKeys' | 'projectLabels'>, task: string): string {
  const from = releaseOfCarry(state.projectKeys, task)
  return from === undefined ? taskPrefix(fixTaskOf(task)) : projectLabel(state, from)
}

export function chainProgress(tasks: Task[], order: ProjectOrder | undefined): { done: number; total: number; backlog: number } {
  const chain = new Set([...(order?.order ?? []), ...(order?.waiting ?? [])])
  const done = tasks.filter((task) => task.status.category === 'Won').length
  const open = tasks.filter((task) => task.status.category !== 'Won' && task.status.category !== 'Lost' && chain.has(task.id)).length
  return { done, total: done + open, backlog: order?.backlog.length ?? 0 }
}

export function backlogTasks(state: EvenKeelState, project: string): Task[] {
  const byId = new Map(projectTasks(state, project).map((task) => [task.id, task]))
  return (state.chain.projects[project]?.backlog ?? []).flatMap((id) => byId.get(id) ?? [])
}

/** The work left in the folders of the project's backlog tasks, by task. */
export function backlogWork(state: EvenKeelState, project: string): Record<string, TaskWork> {
  return Object.fromEntries(
    (state.chain.projects[project]?.backlog ?? []).flatMap((id) => {
      const work = shownWork(state, project, id)
      return work === null ? [] : [[id, work]]
    }),
  )
}

export interface LinkedTask {
  id: string
  title: string | null
  lamp: BlockLamp
}

export interface TaskLinks {
  blockers: LinkedTask[]
  dependents: LinkedTask[]
}

const NO_LINKS: TaskLinks = { blockers: [], dependents: [] }

/** `tasks` with the project's parents the read keeps apart (`EvenKeelState.parents`), so a parent in a chain relation is known. */
export function withParents(tasks: Task[], parents: Task[]): Task[] {
  const known = new Set(tasks.map((task) => task.id))
  return [...tasks, ...parents.filter((parent) => !known.has(parent.id))]
}

/**
 * The open tasks an open task waits for and the open ones waiting for it; a closed task holds nothing.
 * A blocker missing from `tasks` stays, as it cannot be told closed.
 */
export function taskLinks(tasks: Task[], sessions: SessionView[], lanes: readonly ActiveChainView[] = []): (id: string) => TaskLinks {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const waiting = new Map<string, string[]>()
  for (const task of tasks) {
    if (!isOpen(task.status)) continue
    for (const blocker of task.blockedBy) waiting.set(blocker, [...(waiting.get(blocker) ?? []), task.id])
  }
  const live = (id: string) => {
    const task = byId.get(id)
    return task === undefined || isOpen(task.status)
  }
  const linked = (ids: string[]): LinkedTask[] =>
    ids.toSorted(byNumber).map((id) => {
      const task = byId.get(id)
      return { id, title: task?.title ?? null, lamp: taskLamp(task, taskSession(sessions, id) ?? null, false, limitHeld(lanes, id)) }
    })
  return (id) => {
    const task = byId.get(id)
    if (task === undefined || !isOpen(task.status)) return NO_LINKS
    return { blockers: linked(task.blockedBy.filter(live)), dependents: linked(waiting.get(id) ?? []) }
  }
}

export interface Ghost {
  id: string
  title: string
  milestone: string | null
  /** The chain task it would stand right before, `null` for the end. */
  before: string | null
}

/** The stand-in for a backlog task at the place the service says it would take; `null` — the chain would not take it. */
export function ghostOf(state: EvenKeelState, project: string, id: string | null): Ghost | null {
  const order = state.chain.projects[project]
  const landing = order?.landing
  if (id === null || landing === undefined || !Object.hasOwn(landing, id)) return null
  const task = state.tasks.find((each) => each.id === id)
  if (task === undefined) return null
  const milestone = order?.landingMilestones?.[id] ?? task.milestone
  return { id, title: task.title, milestone: milestone?.label ?? null, before: landing[id] ?? null }
}

const trackerCan = (state: EvenKeelState, project: string, move: 'ready' | 'unready' | 'relabel'): boolean =>
  state.trackers.some((view) => view[move] === true && view.projects.includes(project))

/**
 * The "Into the chain" button of a backlog task or a locked blocker, `null` for none: shown where the tracker can move the
 * task out of its backlog status or put the missing required label on (BTN-509). A locked one has it only where the service
 * worked out its place, which leaves out manual tasks, parents and other projects. `refused` — why it is off: once taken,
 * the task would leave the chain without an order.
 */
export interface ReadyButton {
  refused: Notice | null
}

export function readyButton(state: EvenKeelState, project: string, task: { id: string; stage: StatusCategory | null; locked: boolean }): ReadyButton | null {
  const order = state.chain.projects[project]
  const byStatus = task.stage === 'UnStarted' && trackerCan(state, project, 'ready')
  const byLabel = order?.requiredLabel?.[task.id] === false && trackerCan(state, project, 'relabel')
  if (!byStatus && !byLabel) return null
  const refused = order?.refused?.[task.id] ?? null
  if (task.locked && refused === null && !Object.hasOwn(order?.landing ?? {}, task.id)) return null
  return { refused }
}

/**
 * Whether a chain task has the "To the backlog" button: the tracker can move it back to its backlog status or take the
 * required labels off, and no session of it is live — that would be a new way to touch a session (invariant 1).
 */
export const hasLiveSession = (state: EvenKeelState, task: string): boolean => state.sessions.some((view) => view.task === task && view.lamp !== 'finished')

export function canUnready(state: EvenKeelState, project: string, task: { id: string; stage: StatusCategory | null }): boolean {
  if (hasLiveSession(state, task.id)) return false
  const byStatus = (task.stage === 'ToDo' || task.stage === 'Active') && trackerCan(state, project, 'unready')
  return byStatus || (state.chain.projects[project]?.requiredLabel?.[task.id] === true && trackerCan(state, project, 'relabel'))
}

export function openQuestions(tasks: Task[]): number {
  return tasks.filter((task) => task.question && isOpen(task.status)).length
}

/** Whether the task's panel has a session to show: one that ran or runs, or one being started. */
export function hasSession(block: { locked: boolean; session: unknown; start: unknown }): boolean {
  return !block.locked && (block.session !== null || block.start !== null)
}

/**
 * Where the questions figure leads: the session of the first open question that has one — projects in the given
 * order, tasks in chain order — or, while none has a session, the page of the first project with a question.
 */
export function questionPath(state: EvenKeelState, projects: string[]): string | null {
  let page: string | null = null
  for (const project of projects) {
    const questions = new Set(projectTasks(state, project).filter((task) => task.question && isOpen(task.status)).map((task) => task.id))
    if (questions.size === 0) continue
    const block = chainBlocks(state, project).find((each) => questions.has(each.id) && hasSession(each))
    if (block !== undefined) return `${projectPath(project)}#${block.id}`
    page ??= projectPath(project)
  }
  return page
}

export function activeChain(chain: EvenKeelState['chain'], project: string): ActiveChain | undefined {
  return chain.active.find((each) => each.project === project)
}

/** Whether starting one more project runs it at once rather than queueing it. */
export function startsNow(chain: EvenKeelState['chain']): boolean {
  return chain.active.length < chain.parallel
}

export function chainStatus(chain: EvenKeelState['chain'], project: string): ChainStatus {
  const { queue } = chain
  const active = activeChain(chain, project)
  if (active !== undefined) {
    // A paused lane pauses the project: Resume takes every lane.
    const paused = lanesOf(chain, project).find((lane) => lane.paused)
    if (paused !== undefined) return { kind: 'paused', error: paused.error }
    return {
      kind: 'running',
      limitUntil: active.limitUntil ?? null,
      ...(active.slotWait === undefined ? {} : { slotWait: active.slotWait.notice }),
      ...(active.ciWait === undefined ? {} : { ciWait: active.ciWait }),
      ...(active.limitsWait === undefined ? {} : { limitsWait: active.limitsWait }),
    }
  }
  const index = queue.indexOf(project)
  return index < 0 ? { kind: 'idle' } : { kind: 'queued', position: index + 1 }
}

export type ChainControl = 'start' | 'resume' | 'stop'
export type ControlsOff = 'running' | 'idle' | 'queued' | 'notLoaded' | 'failed' | 'empty'

export interface ChainControls {
  enabled: ChainControl[]
  /** The one button that gets the fill: never a disabled one. */
  primary: ChainControl | null
  /** Why a button cannot be pressed now. */
  off: ControlsOff | null
}

export function chainControls(status: ChainStatus, order: ProjectOrder | undefined): ChainControls {
  if (status.kind === 'running') return { enabled: ['stop'], primary: 'stop', off: 'running' }
  if (status.kind === 'paused') return { enabled: ['resume', 'stop'], primary: 'resume', off: null }
  const off = status.kind === 'queued' ? 'queued' : order === undefined ? 'notLoaded' : order.error !== null ? 'failed' : order.order.length === 0 ? 'empty' : null
  return off === null ? { enabled: ['start'], primary: 'start', off: 'idle' } : { enabled: [], primary: null, off }
}

/**
 * The word of the chain's first button follows the status (BTN-1312): Resume only on a paused chain, a running one keeps
 * Start (greyed), so a press of Start never reads as a pause.
 */
export function firstControl(status: ChainStatus, chain: EvenKeelState['chain']): 'resume' | 'start' | 'enqueue' {
  if (status.kind === 'paused') return 'resume'
  return status.kind === 'running' || startsNow(chain) ? 'start' : 'enqueue'
}

export interface UsageNotice {
  tone: 'warn' | 'error'
  text: string
  key: string
}

export function usageNotice(health: UsageHealth): UsageNotice | null {
  if (health.state === 'unread') {
    return {
      tone: 'warn',
      text: t.banner.usageUnread(health.reason === null ? null : say(health.reason)),
      key: `unread:${health.since}`,
    }
  }
  if (health.state === 'off') {
    return {
      tone: 'error',
      text: t.banner.usageOff(health.reason === null ? null : say(health.reason)),
      key: `off:${health.since}`,
    }
  }
  return null
}

export function limitWaitText(until: string, now: Date): string {
  return t.banner.limitHold(formatMoment(until, now))
}

/** The project fixing a red main of the same remote is named by its id: the page shows it through `ProjectLinks`. */
export function ciWaitText(wait: CiWait, now: Date): string {
  if (wait.by !== undefined) return t.banner.remoteFixHold(wait.commit.slice(0, 7), formatMoment(wait.since, now), wait.by)
  const text = wait.after === true ? t.banner.afterGreenHold : wait.local === true ? t.banner.checkHold : t.banner.ciHold
  return text(wait.commit.slice(0, 7), formatMoment(wait.since, now))
}

/** The account by its page name (`say` maps the folder key), the next poll in local time (BTN-619). */
export function limitsWaitText(wait: LimitsWait, now: Date): string {
  return say(notice('chain.limitsUnread', { account: wait.account, ...(wait.next !== null && { next: formatMoment(wait.next, now) }) }))
}

/**
 * The task a project shows: the current one, else the next, else the first of the chain when every open one is held.
 * `lane` — the current one of that lane rather than of the project's head.
 */
export function cardTask(state: EvenKeelState, project: string, lane?: ActiveChain): CardTask | null {
  const current = (lane ?? activeChain(state.chain, project))?.current?.task
  const { order = [], waiting = [] } = state.chain.projects[project] ?? {}
  const skipped = state.chain.skipped[project] ?? []
  const next = current ?? nextTask(projectTasks(state, project), order, [...skipped, ...waiting])
  const id = next ?? order[0]
  if (id === undefined) return null
  const task = state.tasks.find((each) => each.id === id)
  return {
    id,
    title: isFixName(id) ? t.chain.fix : isCarryName(id) ? t.chain.carry(carryLabel(state, id)) : (task?.title ?? null),
    lamp: taskLamp(task, taskSession(state.sessions, id) ?? null, completionTasks(state).has(id), limitHeld(lanesOf(state.chain, project), id)),
    next: current === undefined && next !== undefined,
    ...(next === undefined && { held: skipped.includes(id) ? 'skipped' : 'blocked' }),
  }
}

function startOf(lane: ActiveChain | undefined, current: CurrentTask | null, seen: SessionView | null, runs: TaskSession[], now: Date): Pick<ChainBlock, 'start' | 'handover'> {
  if (current === null) return { start: null }
  const start = sessionStart(current, seen, runs, now)
  const handover = chatHandover(current, start, runs, lane?.paused === true ? lane.error : null)
  return { start, ...(handover !== null && { handover }) }
}

function answeringSince(current: CurrentTask): Pick<ChainBlock, 'answering'> {
  return current.answering && current.starting !== undefined ? { answering: current.starting } : {}
}

export function chainBlocks(state: EvenKeelState, project: string, now = new Date()): ChainBlock[] {
  const tasks = projectTasks(state, project)
  const order = state.chain.projects[project]
  const known = [...tasks, ...(order?.outside ?? [])]
  const byId = new Map(known.map((task) => [task.id, task]))
  const closed = tasks.filter((task) => !isOpen(task.status))
  const after = precedence(tasks.filter((task) => isOpen(task.status)))
  const broken = order === undefined || order.error !== null
  const waiting = new Set(broken ? [] : order.waiting)
  const open = broken
    ? tasks.filter((task) => isOpen(task.status)).map((task) => task.id).sort(byNumber)
    : withWaiting(order.order, order.waiting, new Map(known.map((task) => [task.id, task.blockedBy])), new Map(known.map((task) => [task.id, ancestorsOf(task)])))
  const lanes = lanesOf(state.chain, project)
  // The head lane alone fixes main and carries: the fix and carry rows follow it.
  const active = lanes[0]
  const current = active?.current?.task
  const running = active?.current ?? null
  const pendingOf = (lane: ActiveChain | undefined) => {
    const hold = lane?.current?.limit
    return hold !== undefined && hold.acted === null ? hold : null
  }
  const pending = pendingOf(active)
  const skipped = new Set(state.chain.skipped[project] ?? [])
  const fix = fixNameOf(state.projectKeys, project)
  const next = current === fix && !broken && active?.interrupted === undefined ? nextTask(tasks, order.order, [...skipped, ...order.waiting]) : undefined
  const episodes = state.fixes[project] ?? []
  const ended = new Map(episodes.flatMap((episode) => (episode.end === null ? [] : [[episode.id, episode]])))
  const ownSession = (name: string) => taskSession(state.sessions, name) ?? null
  const fixSession = ownSession(fix)
  const reviews = new Map((order?.reviews ?? []).map((review) => [review.task, review]))
  const shut = closedOrder(closed, state.taskSessions, state.ranAt ?? {}, [...ended.values()])
  // A task waiting on its pull request is out of the chain: its row stands between the closed tasks and the open ones.
  const pulls = [...reviews.keys()].filter((id) => !shut.includes(id) && !open.includes(id)).sort(byNumber)
  const refused = completionTasks(state)

  const blocks = [...shut, ...pulls, ...open].map((id): ChainBlock => {
    const episode = ended.get(id)
    if (episode !== undefined) {
      const sessions = state.taskSessions[id] ?? []
      const own = ownSession(fixTaskOf(id))
      const session = own !== null && sessions.some((run) => run.sessionId === own.sessionId) ? own : null
      const row = isCarryName(id) ? fixRow(id, carryTitle(state, episode), 'done', null, session, sessions) : fixRow(id, fixTitle(episode), 'fixed', null, session, sessions)
      const machines = taskMachines(state, sessions, undefined)
      return { ...row, fix: episode, ...(machines !== undefined && { machines }) }
    }
    const task = byId.get(id)
    const seen = taskSession(state.sessions, id) ?? null
    const lane = laneOfTask(lanes, id)
    const ownRun = lane?.current ?? null
    // Delivering an answer stops the session for a few seconds; to the page it is already at work on it, as is a fresh
    // session idling before its prompt.
    const session =
      seen !== null && ownRun?.answering === true
        ? { ...seen, lamp: 'working' as const, ask: null }
        : seen !== null && idleBeforePrompt(seen, now)
          ? { ...seen, lamp: 'working' as const }
          : seen
    const sessions = state.taskSessions[id] ?? []
    const pins = state.runs[project]?.[id]?.machines
    const machines = taskMachines(state, sessions, lane)
    const pinned = machines === undefined ? pinnedMachines(state, pins) : undefined
    const pinWait = state.pinWaits?.[project]?.[id]
    const stranded = lane === undefined ? state.stranded?.[project]?.[id] : undefined
    const lamp = taskLamp(task, session, refused.has(id), limitHeld(lanes, id))
    const left = (state.chain.leftovers[project] ?? []).filter((each) => each.task === id)
    const work = shownWork(state, project, id)
    return {
      id,
      title: task?.title ?? null,
      status: task?.status.name ?? null,
      stage: task?.status.category ?? null,
      lamp,
      open: task !== undefined && isOpen(task.status) && !waiting.has(id) && !pulls.includes(id),
      locked: waiting.has(id),
      blockedBy: task?.blockedBy ?? [],
      milestone: task?.milestone?.label ?? null,
      after: after.get(id) ?? [],
      current: lane !== undefined,
      skipped: skipped.has(id),
      question: task?.question ?? false,
      priority: task?.priority ?? 'none',
      estimate: task?.estimate ?? null,
      parent: task?.parent ?? null,
      ...(task !== undefined && { ancestors: ancestorsOf(task) }),
      labels: task?.labels ?? [],
      run: state.runs[project]?.[id] ?? null,
      session,
      sessions,
      limit: pendingOf(lane),
      ...(lane?.spent !== undefined && { spent: lane.spent }),
      ...startOf(lane, ownRun, seen, sessions, now),
      ...(ownRun !== null && answeringSince(ownRun)),
      ...(machines !== undefined && { machines }),
      ...(pinned !== undefined && { machines: pinned, pinned: true as const }),
      ...(pinWait !== undefined && pins !== undefined && { pinWait: { why: pinWait, machines: pins.map((pin) => state.machineNames?.[pin] ?? pin) } }),
      ...(stranded !== undefined && { stranded: { machine: state.machineNames?.[stranded.machine] ?? stranded.machine, pushed: stranded.pushed } }),
      ...(id === active?.interrupted?.task && { interrupted: true as const }),
      ...(lane?.paused === true && lamp === 'stopped' && { halted: true as const }),
      ...(id === next && session !== null && session.lamp !== 'finished' && { aside: true as const }),
      ...(active === undefined && session !== null && session.lamp !== 'finished' && { loose: true as const }),
      ...(reviews.has(id) && { review: reviews.get(id)! }),
      ...(work !== null && { work, ...(isClosedLamp(lamp) && { leftovers: left.map((each) => each.notice) }) }),
    }
  })
  for (let index = blocks.length - 2; index >= 0; index--) {
    if (blocks[index]!.locked) blocks[index]!.milestone = blocks[index + 1]!.milestone
  }
  // A fix that is over has no milestone of its own: it stays in the section of its neighbours.
  for (const [index, block] of blocks.entries()) {
    if (block.fix !== undefined) block.milestone = blocks[index - 1]?.milestone ?? blocks.slice(index + 1).find((each) => each.fix === undefined)?.milestone ?? null
  }
  // A session without a tracker task leads the chain as a block of its own, ahead of the open tasks.
  const ahead = (rows: ChainBlock[]) => {
    const at = rows.findIndex((block) => block.open || block.locked)
    return at < 0 ? rows.length : at
  }
  const liveBlock = (name: string, title: string, at: number, rows: ChainBlock[]): ChainBlock => {
    const id = liveFixId(name, episodes)
    const sessions = state.taskSessions[id] ?? []
    // A session of the name is the row's only once it runs or is one of this episode's: a carry asked for has none yet.
    const named = ownSession(name)
    const seen = named !== null && (name === current || sessions.some((run) => run.sessionId === named.sessionId)) ? named : null
    const session = seen !== null && idleBeforePrompt(seen, now) ? { ...seen, lamp: 'working' as const } : seen
    // With machines the fix runs in the lane `MainFix.fixer` chose, not always the head one (BTN-1572).
    const machines = taskMachines(state, sessions, laneOfTask(lanes, name))
    return {
      ...fixRow(id, title, taskLamp(undefined, session, false, limitHeld(lanes, name)), rows[at]?.milestone ?? null, session, sessions),
      ...(machines !== undefined && { machines }),
      open: true,
      current: name === current,
      limit: name === current ? pending : null,
      ...(name === current && active?.spent !== undefined && { spent: active.spent }),
      ...startOf(active, running?.task === name ? running : null, seen, sessions, now),
      ...(running?.task === name && answeringSince(running)),
    }
  }
  let rows = blocks
  const lingers = fixSession !== null && fixSession.lamp !== 'finished' && episodes.filter((episode) => isFixName(episode.id)).at(-1)?.end == null
  if (current === fix || lingers) rows = rows.toSpliced(ahead(rows), 0, liveBlock(fix, t.chain.fix, ahead(rows), rows))
  // The carry an agent resolves (BTN-369): asked for, it waits right after the current task; then it leads the chain.
  const carries = new Set(Object.values(state.forwards).flatMap((view) => (view.into === project && view.agent !== undefined ? [view.agent] : [])))
  if (current !== undefined && isCarryName(current)) carries.add(current)
  for (const name of carries) {
    const label = carryLabel(state, name)
    if (name === current) {
      rows = rows.toSpliced(ahead(rows), 0, liveBlock(name, t.chain.carry(label), ahead(rows), rows))
      continue
    }
    const anchor = active?.interrupted?.task ?? (current === fix ? liveFixId(fix, episodes) : current)
    const after = rows.findIndex((block) => block.id === anchor)
    const at = after < 0 ? ahead(rows) : after + 1
    rows = rows.toSpliced(at, 0, liveBlock(name, t.chain.carryAsked(label), at, rows))
  }
  return rows
}

/** The row a link to a fix or a carry by its name (`ABC-FIX`) means: the one running now, otherwise the one its session is on. */
export function fixBlockOf(blocks: ChainBlock[], hash: string): string | null {
  if (!isOwnName(hash) || blocks.some((block) => block.id === hash)) return null
  const rows = blocks.filter((block) => fixTaskOf(block.id) === hash)
  return (rows.find((block) => block.fix === undefined) ?? rows.findLast((block) => block.session?.task === hash))?.id ?? null
}

function fixRow(id: string, title: string, lamp: BlockLamp, milestone: string | null, session: SessionView | null, sessions: TaskSession[]): ChainBlock {
  return {
    id,
    title,
    status: null,
    stage: null,
    lamp,
    open: false,
    locked: false,
    blockedBy: [],
    milestone,
    after: [],
    current: false,
    skipped: false,
    question: false,
    priority: 'none',
    estimate: null,
    parent: null,
    labels: [],
    run: null,
    session,
    sessions,
    limit: null,
    start: null,
  }
}

const SHORT_COMMIT = 7

function fixTitle(episode: FixEpisode): string {
  const short = (commit: string | null) => commit?.slice(0, SHORT_COMMIT) ?? null
  if (episode.end?.how === 'landed') return t.chain.fixLanded(short(episode.red), short(episode.end.commit))
  if (episode.end?.how !== 'unneeded') return t.chain.fixDropped(short(episode.red))
  // Unneeded at a commit past the red one: main was fixed outside the chain (BTN-1328).
  const { commit } = episode.end
  return commit === null || commit === episode.red ? t.chain.fixUnneeded(short(episode.red)) : t.chain.fixOutrun(short(episode.red), commit.slice(0, SHORT_COMMIT))
}

function carryTitle(state: Pick<EvenKeelState, 'projectKeys' | 'projectLabels'>, episode: FixEpisode): string {
  const label = carryLabel(state, episode.id)
  return episode.end?.how === 'carried' ? t.chain.carried(label, episode.end.commits ?? 0) : t.chain.carryDropped(label)
}

export function contextFill(tokens: number, scale: ContextScale | null, window: number | null): { percent: number | null; level: ContextLevel } {
  if (window === null || window <= 0) return { percent: null, level: 'ok' }
  const percent = Math.min(100, (tokens / window) * 100)
  const level = scale === null ? 'ok' : percent >= scale.danger ? 'danger' : percent >= scale.warn ? 'warn' : 'ok'
  return { percent, level }
}

export function queuedAfter(chain: EvenKeelState['chain'], project: string): string | null {
  const index = chain.queue.indexOf(project)
  if (index < 0) return null
  if (index > 0) return chain.queue[index - 1]!
  return chain.active.length === 1 ? chain.active[0]!.project : null
}

/** From the launch to now; a finished session, or one waiting out a limit, stops at its last activity. */
export function sessionElapsed(view: SessionView, now: Date, limited = false): number {
  const start = Date.parse(view.startedAt)
  const end = view.lamp === 'finished' || limited ? Date.parse(view.lastActivityAt ?? view.startedAt) : now.getTime()
  return Math.max(0, end - start)
}

const CACHE_TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '30m': 30 * 60_000, '1h': 60 * 60_000 }

export function cacheFreshness(cache: CacheWindow, now: Date): { left: number; level: 'ok' | 'warn' | 'cold' } {
  const left = Math.max(0, Date.parse(cache.until) - now.getTime())
  const level = left === 0 ? 'cold' : left < CACHE_TTL_MS[cache.ttl] / 5 ? 'warn' : 'ok'
  return { left, level }
}

/**
 * The cache window the page counts down: the transcript's, unless a keep-warm ping read the cache later — its fork
 * writes no transcript, so the cache lives a lifetime after the last ping (EKR-143).
 */
export function sessionCache(session: Pick<SessionView, 'cache' | 'warm'>): CacheWindow | null {
  const { cache, warm } = session
  if (cache === null || warm == null) return cache
  const until = Date.parse(warm.at) + CACHE_TTL_MS[cache.ttl]
  return until > Date.parse(cache.until) ? { ...cache, until: new Date(until).toISOString() } : cache
}

/** The part of the cache lifetime left, 1 to 0: the ring of the chain's row. */
export function cacheShare(cache: CacheWindow, now: Date): number {
  return Math.min(1, cacheFreshness(cache, now).left / CACHE_TTL_MS[cache.ttl])
}

/** How loud the panel draws the cache: quiet until it is about to run out, and for a finished session always. */
export function cacheTone(cache: CacheWindow | null, now: Date, lamp: Lamp): ContextLevel {
  if (cache === null || lamp === 'finished') return 'ok'
  const { level } = cacheFreshness(cache, now)
  return level === 'cold' ? 'danger' : level
}

export function tokenTotal(tokens: TokenTotals): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
}

export function issueLink(urls: TrackerUrls, task: string): string | null {
  if (isOwnName(task)) return null
  const prefix = taskPrefix(task)
  const template = Object.hasOwn(urls.projects, prefix) ? urls.projects[prefix]! : urls.default
  return template === null ? null : template.replaceAll('{id}', task).replaceAll('{number}', task.slice(prefix.length + 1))
}

/**
 * The session a task's card shows: an unfinished one, else the latest started. The list is no time order: the hub's sessions
 * come before those of machines elsewhere (BTN-1626).
 */
export function taskSession(sessions: SessionView[], task: string): SessionView | undefined {
  const own = sessions.filter((view) => view.task === task)
  return (
    own.find((view) => view.lamp !== 'finished') ??
    own.reduce<SessionView | undefined>((latest, view) => (latest === undefined || Date.parse(view.startedAt) >= Date.parse(latest.startedAt) ? view : latest), undefined)
  )
}

/**
 * Closed tasks by their last launch, those never launched first; a fix that is over by the time it ended. `ranAt` — the
 * last launch of a task whose runs the state leaves out (BTN-1256).
 */
function closedOrder(tasks: Task[], runs: Record<string, TaskSession[]>, ranAt: Record<string, string>, fixes: FixEpisode[]): string[] {
  let order: string[]
  try {
    order = chainOrder(tasks)
  } catch {
    order = tasks.map((task) => task.id).sort(byNumber)
  }
  const ends = new Map(fixes.map((episode) => [episode.id, episode.end!.at]))
  const lastRun = (id: string) => ends.get(id) ?? runs[id]?.reduce((last, run) => (run.at > last ? run.at : last), '') ?? ranAt[id] ?? ''
  const never = order.filter((id) => lastRun(id) === '')
  const ran = [...order.filter((id) => lastRun(id) !== ''), ...ends.keys()].sort((a, b) => lastRun(a).localeCompare(lastRun(b)))
  return [...never, ...ran]
}

