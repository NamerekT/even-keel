import type { AccountEntry, AccountLogin, AccountView } from '../../src/account/model.js'
import type { ActiveChain, CurrentTask, ProjectOrder, ReviewView } from '../../src/chain/dispatcher.js'
import { fixNameOf, fixTaskOf, isFixName, liveFixId, projectOfFix } from '../../src/chain/fix.js'
import type { FixEpisode, TaskSession } from '../../src/chain/launches.js'
import { chainOrder, nextTask, precedence, withWaiting } from '../../src/chain/order.js'
import type { LimitHold } from '../../src/chain/relay.js'
import { PROJECT_COLORS } from '../../src/projects/colors.js'
import { isOpen, runLabelText, type StatusCategory, type Task, type TaskPriority } from '../../src/tracker/model.js'
import type { Lamp } from '../../src/sessions/agents.js'
import type { CacheTtl, CacheWindow, TokenTotals } from '../../src/sessions/transcript.js'
import type { UsageHealth } from '../../src/limits/usage.js'
import type { Notice } from '../../src/notice/notice.js'
import type { EvenKeelState, ContextScale, ProjectTask, SessionView, TaskWork, TrackerUrls } from '../../src/state.js'
import { accountName } from './accountName.js'
import { formatMoment } from './format.js'
import { say, t } from './i18n/index.js'
import { shownWork } from './work.js'

export interface AccountBadge {
  kind: 'in' | 'out' | 'login' | 'unknown'
  label: string
}

/** The header's badge of the active account: a sign-in shows on it only when it is into that folder, not a new account's. */
export function accountBadge(view: AccountView): AccountBadge {
  const active = view.accounts.find((entry) => entry.key === view.active)
  return active === undefined ? { kind: 'unknown', label: 'Claude' } : entryBadge(active, view.login, view.accounts)
}

/** The badge of one account: only a sign-in into this very folder shows on it; its name is `accountName`'s, an e-mail's local part only. */
export function entryBadge(entry: AccountEntry, login: AccountLogin | null, accounts: AccountEntry[] = [entry]): AccountBadge {
  if (login !== null && login.target === entry.key) {
    return login.error === null ? { kind: 'login', label: t.account.loggingIn } : { kind: 'out', label: t.account.loginFailed }
  }
  const name = accountName(entry, accounts)
  if (entry.status == null) return { kind: 'unknown', label: name }
  if (entry.needsLogin) return { kind: 'out', label: t.account.needsLogin }
  return { kind: 'in', label: entry.name === null && name === entry.status.email ? name.split('@')[0]! : name }
}

/** The accounts the header shows: the one holding the Even Keel role, then every other one a project runs on. */
export function headerAccounts(view: AccountView): AccountEntry[] {
  const active = view.accounts.find((entry) => entry.key === view.active)
  const others = view.accounts.filter((entry) => entry.key !== view.active && entry.projects.length > 0)
  return active === undefined ? others : [active, ...others]
}

const DAY_MS = 24 * 60 * 60_000
const RENEW_WITHIN_DAYS = 7

export function loginLeft(expiresAt: string | null, now: Date): { text: string; renew: boolean } {
  if (expiresAt === null) return { text: '—', renew: false }
  const left = Date.parse(expiresAt) - now.getTime()
  if (left <= 0) return { text: t.account.expired, renew: true }
  const days = Math.floor(left / DAY_MS)
  return { text: days === 0 ? t.account.underDay : t.account.days(days), renew: days < RENEW_WITHIN_DAYS }
}

export function limitedUntil(entry: AccountEntry, now: Date): string | null {
  const spent = [entry.limits?.fiveHour, entry.limits?.sevenDay, entry.limits?.month]
    .filter((window) => window != null && window.usedPercentage >= 100 && Date.parse(window.resetsAt) > now.getTime())
    .map((window) => window!.resetsAt)
  return spent.length === 0 ? null : spent.reduce((later, each) => (Date.parse(each) > Date.parse(later) ? each : later))
}

export function canWork(entry: AccountEntry, now: Date): boolean {
  return entry.status?.loggedIn === true && !entry.needsLogin && !entry.removing && limitedUntil(entry, now) === null
}

export function accountOrder(entries: AccountEntry[], now: Date): AccountEntry[] {
  return [...entries.filter((entry) => canWork(entry, now)), ...entries.filter((entry) => !canWork(entry, now))]
}

type CiWait = NonNullable<ActiveChain['ciWait']>

export type ChainStatus =
  | { kind: 'running'; limitUntil: string | null; slotWait?: Notice; ciWait?: CiWait }
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
  labels: string[]
  /** The task's run labels as `runLabelText` writes them. */
  runLabels: string[]
  session: SessionView | null
  sessions: TaskSession[]
  limit: LimitHold | null
  start: SessionStart | null
  /** Since when the chain is delivering the user's answer to the task's session: stopping it and resuming it with the answer. */
  answering?: string
  /** A red main stopped the task's session; it goes on once main is fixed. */
  interrupted?: true
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
}

/**
 * `launch`, `handover` — the service is starting the session; `boot` — the page does not see the new session yet;
 * `answer` — the session is up and has not answered yet.
 */
export interface SessionStart {
  phase: StartPhase
  since: string
}

export type StartPhase = 'launch' | 'handover' | 'boot' | 'answer'

const BOOT_WAIT_MS = 5 * 60_000

export type ContextLevel = 'ok' | 'warn' | 'danger'

export const PROJECT_SLOTS = PROJECT_COLORS

const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

export function projectTasks(state: Pick<EvenKeelState, 'tasks'>, project: string): ProjectTask[] {
  return state.tasks.filter((task) => task.project === project)
}

export function waitingSessions(sessions: SessionView[], tasks: Task[]): SessionView[] {
  const open = new Set(tasks.filter((task) => isOpen(task.status)).map((task) => task.id))
  const since = (view: SessionView) => Date.parse(view.lastActivityAt ?? view.startedAt)
  return sessions
    .filter((view) => view.lamp === 'waiting' && !view.checkpoint && (open.has(view.task) || isFixName(view.task)))
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
    else if (row.how === 'relay') resets[(row.cause ?? 'limit') === 'limit' ? 'limit' : 'relay']++
    resets.compactions += row.compactions ?? 0
  }
  resets.total = resets.checkpoint + resets.limit + resets.relay + resets.restart + resets.compactions
  return resets
}

/** The prefix of a task id or fix name: `ABC` of `ABC-12`. */
export function taskPrefix(task: string): string {
  return task.replace(/-(\d+|FIX)$/, '')
}

/**
 * The project of a task or of a fix episode, by id (BTN-271): the one its fix name is of, the one listing the task,
 * else the first with its prefix; the prefix itself when no project has it.
 */
export function taskProject(state: Pick<EvenKeelState, 'tasks' | 'projectKeys' | 'taskPrefixes'> | null, task: string): string {
  if (state === null) return taskPrefix(fixTaskOf(task))
  if (isFixName(task)) return projectOfFix(state.projectKeys, task) ?? taskPrefix(fixTaskOf(task))
  const listed = state.tasks.find((each) => each.id === task)?.project
  if (listed !== undefined) return listed
  const prefix = taskPrefix(task)
  return Object.keys(state.taskPrefixes).find((project) => state.taskPrefixes[project] === prefix) ?? prefix
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

/**
 * The open tasks an open task waits for and the open ones waiting for it; a closed task holds nothing.
 * A blocker missing from `tasks` stays, as it cannot be told closed.
 */
export function taskLinks(tasks: Task[], sessions: SessionView[]): (id: string) => TaskLinks {
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
      return { id, title: task?.title ?? null, lamp: taskLamp(task, taskSession(sessions, id) ?? null) }
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
  const landing = state.chain.projects[project]?.landing
  if (id === null || landing === undefined || !Object.hasOwn(landing, id)) return null
  const task = state.tasks.find((each) => each.id === id)
  if (task === undefined) return null
  return { id, title: task.title, milestone: task.milestone?.label ?? null, before: landing[id] ?? null }
}

export function canReady(state: EvenKeelState, project: string): boolean {
  return state.trackers.some((view) => view.ready && view.projects.includes(project))
}

/**
 * The "Move to Todo" button of a backlog task or a locked blocker, `null` for none: a locked one has it only where the service
 * worked out its place, which leaves out manual tasks, parents and other projects. `refused` — why it is off: once taken,
 * the task would leave the chain without an order.
 */
export interface ReadyButton {
  refused: Notice | null
}

export function readyButton(state: EvenKeelState, project: string, task: { id: string; stage: StatusCategory | null; locked: boolean }): ReadyButton | null {
  if (!canReady(state, project) || task.stage !== 'UnStarted') return null
  const order = state.chain.projects[project]
  const refused = order?.refused?.[task.id] ?? null
  if (task.locked && refused === null && !Object.hasOwn(order?.landing ?? {}, task.id)) return null
  return { refused }
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
    if (active.paused) return { kind: 'paused', error: active.error }
    return {
      kind: 'running',
      limitUntil: active.limitUntil ?? null,
      ...(active.slotWait === undefined ? {} : { slotWait: active.slotWait.notice }),
      ...(active.ciWait === undefined ? {} : { ciWait: active.ciWait }),
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

/** The task a project shows: the current one, else the next, else the first of the chain when every open one is held. */
export function cardTask(state: EvenKeelState, project: string): CardTask | null {
  const current = activeChain(state.chain, project)?.current?.task
  const { order = [], waiting = [] } = state.chain.projects[project] ?? {}
  const skipped = state.chain.skipped[project] ?? []
  const next = current ?? nextTask(projectTasks(state, project), order, [...skipped, ...waiting])
  const id = next ?? order[0]
  if (id === undefined) return null
  const task = state.tasks.find((each) => each.id === id)
  return {
    id,
    title: isFixName(id) ? t.chain.fix : (task?.title ?? null),
    lamp: taskLamp(task, taskSession(state.sessions, id) ?? null),
    next: current === undefined && next !== undefined,
    ...(next === undefined && { held: skipped.includes(id) ? 'skipped' : 'blocked' }),
  }
}

/** The project's page: by its id, which outlives a change of the key. */
export function projectPath(project: string): string {
  return `/p/${encodeURIComponent(project)}`
}

/**
 * The project a page address names: by its id, or by its key in a link from before ids (`byKey`, to be redirected) —
 * the first project of the key.
 */
export function projectOfPath(state: Pick<EvenKeelState, 'projects' | 'projectKeys'>, param: string): { project: string; byKey: boolean } {
  if (state.projects.includes(param)) return { project: param, byKey: false }
  const byKey = state.projects.find((project) => state.projectKeys[project] === param)
  return byKey === undefined ? { project: param, byKey: false } : { project: byKey, byKey: true }
}

/** What the page shows a project by (`projectLabel`): its key, with its name where another project has the key. */
export function projectLabel(state: Pick<EvenKeelState, 'projectLabels'> | null, project: string): string {
  return state?.projectLabels[project] ?? project
}

export function projectName(state: EvenKeelState, project: string): string | null {
  return state.config.projects[project]?.name ?? null
}

/** The tracker a project's card marks it with: its kind for the icon, the tracker with its profile and the tracker project for the tip. */
export function projectTracker(state: EvenKeelState, project: string): { kind: string; label: string } | null {
  const view = state.trackers.find((each) => each.projects.includes(project))
  if (view === undefined) return null
  const trackerProject = state.config.projects[project]?.trackerProject ?? null
  return { kind: view.kind, label: trackerProject === null ? view.title : `${view.title} · ${trackerProject}` }
}

/**
 * The pages where the project's new tasks are filed: its own in its tracker, then each feed's (BTN-329), with the tracker's
 * own name (`Huly`) for the button; two pages of one tracker add their keys to it.
 */
export function projectPages(state: EvenKeelState, project: string): { url: string; tracker: string | null }[] {
  const titleOf = (kind: string | undefined) => state.config.trackers.find((each) => each.name === kind)?.title ?? null
  const own = { id: project, key: state.projectKeys[project] ?? project, tracker: titleOf(state.trackers.find((each) => each.projects.includes(project))?.kind) }
  const feeds = (state.config.feeds[project] ?? []).map((feed) => ({ id: feed.id, key: feed.key, tracker: titleOf(feed.tracker) }))
  const pages = [own, ...feeds].flatMap(({ id, ...page }) => {
    const url = state.trackerUrls.pages[id] ?? null
    return url === null ? [] : [{ url, ...page }]
  })
  return pages.map(({ url, key, tracker }) => {
    const shared = pages.filter((other) => other.tracker === tracker).length > 1
    return { url, tracker: !shared ? tracker : tracker === null ? key : `${tracker} · ${key}` }
  })
}

/** The palette slot of a project: its `color` setting (BTN-207); `null` — none, or not a project of the config. */
export function projectSlot(state: Pick<EvenKeelState, 'config'>, project: string): number | null {
  return state.config.projects[project]?.color ?? null
}

/** The slot of every project of the config by its id. */
export function projectSlots(state: Pick<EvenKeelState, 'config'>): Record<string, number | null> {
  return Object.fromEntries(Object.keys(state.config.projects).map((project) => [project, projectSlot(state, project)]))
}

/** The slots by project key, as Tally labels the projects; a key shared by several projects (BTN-271) takes the first one's in the config order. */
export function keySlots(state: Pick<EvenKeelState, 'config' | 'projectKeys'>): Record<string, number | null> {
  const slots: Record<string, number | null> = {}
  for (const project of Object.keys(state.config.projects)) {
    const key = state.projectKeys[project] ?? project
    if (!Object.hasOwn(slots, key)) slots[key] = projectSlot(state, project)
  }
  return slots
}

export function sessionStart(current: CurrentTask, session: SessionView | null, runs: TaskSession[], now: Date): SessionStart | null {
  if (current.sessionId === null) return { phase: 'launch', since: current.starting ?? current.since }
  if (current.answering) return null
  if (current.starting !== undefined) return { phase: 'handover', since: current.starting }
  const run = runs.find((each) => each.sessionId === current.sessionId)
  if (run !== undefined && run.answers + run.resumed > 0) return null
  const seen = session?.sessionId === current.sessionId ? session : null
  const since = run?.at ?? seen?.startedAt
  if (since === undefined || now.getTime() - Date.parse(since) > BOOT_WAIT_MS) return null
  if (seen === null) return { phase: 'boot', since }
  return seen.lamp === 'working' && seen.contextTokens === 0 ? { phase: 'answer', since } : null
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
    : withWaiting(order.order, order.waiting, new Map(known.map((task) => [task.id, task.blockedBy])))
  const active = activeChain(state.chain, project)
  const current = active?.current?.task
  const running = active?.current ?? null
  const hold = active?.current?.limit
  const pending = hold !== undefined && hold.acted === null ? hold : null
  const skipped = new Set(state.chain.skipped[project] ?? [])
  const fix = fixNameOf(state.projectKeys, project)
  const next = current === fix && !broken && active?.interrupted === undefined ? nextTask(tasks, order.order, [...skipped, ...order.waiting]) : undefined
  const episodes = state.fixes[project] ?? []
  const ended = new Map(episodes.flatMap((episode) => (episode.end === null ? [] : [[episode.id, episode]])))
  const fixSession = taskSession(state.sessions, fix) ?? null
  const reviews = new Map((order?.reviews ?? []).map((review) => [review.task, review]))
  const shut = closedOrder(closed, state.taskSessions, [...ended.values()])
  // A task waiting on its pull request is out of the chain: its row stands between the closed tasks and the open ones.
  const pulls = [...reviews.keys()].filter((id) => !shut.includes(id) && !open.includes(id)).sort(byNumber)

  const blocks = [...shut, ...pulls, ...open].map((id): ChainBlock => {
    const episode = ended.get(id)
    if (episode !== undefined) {
      const sessions = state.taskSessions[id] ?? []
      const session = fixSession !== null && sessions.some((run) => run.sessionId === fixSession.sessionId) ? fixSession : null
      return { ...fixRow(id, fixTitle(episode), 'fixed', null, session, sessions), fix: episode }
    }
    const task = byId.get(id)
    const seen = taskSession(state.sessions, id) ?? null
    // Delivering an answer stops the session for a few seconds; to the page it is already at work on it.
    const session = seen !== null && running?.task === id && running.answering ? { ...seen, lamp: 'working' as const, ask: null } : seen
    const sessions = state.taskSessions[id] ?? []
    const lamp = taskLamp(task, session)
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
      current: id === current,
      skipped: skipped.has(id),
      question: task?.question ?? false,
      priority: task?.priority ?? 'none',
      estimate: task?.estimate ?? null,
      parent: task?.parent ?? null,
      labels: task?.labels ?? [],
      runLabels: (task?.runLabels ?? []).map(runLabelText),
      session,
      sessions,
      limit: id === current ? pending : null,
      start: running?.task === id ? sessionStart(running, session, sessions, now) : null,
      ...(running?.task === id && answeringSince(running)),
      ...(id === active?.interrupted?.task && { interrupted: true as const }),
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
  const lingers = fixSession !== null && fixSession.lamp !== 'finished' && episodes.at(-1)?.end == null
  if (current !== fix && !lingers) return blocks
  // The fix session of a red main is not a tracker task: it leads the chain as a block of its own, ahead of the open tasks.
  const at = blocks.findIndex((block) => block.open || block.locked)
  const ahead = at < 0 ? blocks.length : at
  const id = liveFixId(fix, episodes)
  const fixSessions = state.taskSessions[id] ?? []
  const fixBlock: ChainBlock = {
    ...fixRow(id, t.chain.fix, taskLamp(undefined, fixSession), blocks[ahead]?.milestone ?? null, fixSession, fixSessions),
    open: true,
    current: fix === current,
    limit: fix === current ? pending : null,
    start: running?.task === fix ? sessionStart(running, fixSession, fixSessions, now) : null,
    ...(running?.task === fix && answeringSince(running)),
  }
  return blocks.toSpliced(ahead, 0, fixBlock)
}

/** The row a link to a fix by its name (`ABC-FIX`) means: the fix running now, otherwise the one its session is on. */
export function fixBlockOf(blocks: ChainBlock[], hash: string): string | null {
  if (!isFixName(hash) || blocks.some((block) => block.id === hash)) return null
  const rows = blocks.filter((block) => isFixName(block.id))
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
    runLabels: [],
    session,
    sessions,
    limit: null,
    start: null,
  }
}

const SHORT_COMMIT = 7

function fixTitle(episode: FixEpisode): string {
  const short = (commit: string | null) => commit?.slice(0, SHORT_COMMIT) ?? null
  return episode.end?.how === 'landed' ? t.chain.fixLanded(short(episode.red), short(episode.end.commit)) : t.chain.fixDropped(short(episode.red))
}

/** `window` is the session's own, as its agent gave it; `null` — the setting's `scale.window` stands in. */
export function contextFill(tokens: number, scale: ContextScale, window: number | null = null): { percent: number; level: ContextLevel } {
  const percent = Math.min(100, (tokens / (window ?? scale.window)) * 100)
  const level = percent >= scale.danger ? 'danger' : percent >= scale.warn ? 'warn' : 'ok'
  return { percent, level }
}

export function queuedAfter(chain: EvenKeelState['chain'], project: string): string | null {
  const index = chain.queue.indexOf(project)
  if (index < 0) return null
  if (index > 0) return chain.queue[index - 1]!
  return chain.active.length === 1 ? chain.active[0]!.project : null
}

export function sessionElapsed(view: SessionView, now: Date): number {
  const start = Date.parse(view.startedAt)
  const end = view.lamp === 'finished' ? Date.parse(view.lastActivityAt ?? view.startedAt) : now.getTime()
  return Math.max(0, end - start)
}

const CACHE_TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

export function cacheFreshness(cache: CacheWindow, now: Date): { left: number; level: 'ok' | 'warn' | 'cold' } {
  const left = Math.max(0, Date.parse(cache.until) - now.getTime())
  const level = left === 0 ? 'cold' : left < CACHE_TTL_MS[cache.ttl] / 5 ? 'warn' : 'ok'
  return { left, level }
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
  if (isFixName(task)) return null
  const prefix = taskPrefix(task)
  const template = Object.hasOwn(urls.projects, prefix) ? urls.projects[prefix]! : urls.default
  return template === null ? null : template.replaceAll('{id}', task).replaceAll('{number}', task.slice(prefix.length + 1))
}

function taskSession(sessions: SessionView[], task: string): SessionView | undefined {
  const own = sessions.filter((view) => view.task === task)
  return own.find((view) => view.lamp !== 'finished') ?? own.at(-1)
}

/** Closed tasks by their last launch, those never launched first; a fix that is over by the time it ended. */
function closedOrder(tasks: Task[], runs: Record<string, TaskSession[]>, fixes: FixEpisode[]): string[] {
  let order: string[]
  try {
    order = chainOrder(tasks)
  } catch {
    order = tasks.map((task) => task.id).sort(byNumber)
  }
  const ends = new Map(fixes.map((episode) => [episode.id, episode.end!.at]))
  const lastRun = (id: string) => ends.get(id) ?? runs[id]?.reduce((last, run) => (run.at > last ? run.at : last), '') ?? ''
  const never = order.filter((id) => lastRun(id) === '')
  const ran = [...order.filter((id) => lastRun(id) !== ''), ...ends.keys()].sort((a, b) => lastRun(a).localeCompare(lastRun(b)))
  return [...never, ...ran]
}

/** The tracker's status first: a finished session lights a task done only when the task is done. */
function taskLamp(task: Task | undefined, session: SessionView | null): BlockLamp {
  if (task?.status.category === 'Won') return 'done'
  if (task?.status.category === 'Lost') return 'canceled'
  if (session === null) return task?.status.category === 'UnStarted' ? 'backlog' : 'ahead'
  if (session.checkpoint && (session.lamp === 'waiting' || session.lamp === 'finished')) return 'handoff'
  return session.lamp === 'finished' ? 'stopped' : session.lamp
}
