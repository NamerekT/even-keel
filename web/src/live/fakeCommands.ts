import { fail } from '../../../src/notice/notice.js'
import { restartConfirmation, silentRestart } from '../../../src/sessions/silence.js'
import type { ActiveChain, LaunchEntry } from '../../../src/chain/dispatcher.js'
import { isOwnName } from '../../../src/chain/fix.js'
import { launchDays } from '../../../src/chain/launches.js'
import { checkOrder, startsAhead } from '../../../src/chain/order.js'
import type { EvenKeelState, ProjectTask, SessionView } from '../../../src/state.js'
import { accountCommand, withAccount } from './fakeAccounts.js'
import { fakeUpdatesCommand } from './fakeUpdates.js'
import { fakeSettingsCommand } from './fakeConfig.js'
import { fakeCliCommand, syncFakeCliSources } from './fakeCliCopies.js'
import { fakeMoveMilestone, fakeReady, fakeUnready } from './fakeCards.js'
import { fakeResolve } from './fakeCarry.js'
import { fakeAnswer, fakeDismissMail } from './fakeChat.js'
import { fakePackagesCommand } from './fakePackages.js'
import { fakeSecretsCommand, fakeTally } from './fakeSecrets.js'
import { fakeProfilesCommand } from './fakeProfiles.js'
import { fakeProjectCommand } from './fakeProjects.js'
import { ago, minutes, session, task } from './fakeSessions.js'

export const LAUNCH_DAYS = 14

const FRESH_TITLES = ['Сводка за ночь на главной', 'Подсветка новых задач', 'Экспорт журнала запусков', 'Повтор упавшей сессии']

function chainIn(state: EvenKeelState, project: string): ActiveChain | undefined {
  return state.chain.active.find((chain) => chain.project === project)
}

function withChain(state: EvenKeelState, chain: ActiveChain, next: ActiveChain | null): EvenKeelState {
  const active = state.chain.active.flatMap((each) => (each !== chain ? [each] : next === null ? [] : [next]))
  return { ...state, chain: { ...state.chain, active } }
}

/**
 * What the page sees after a start or a restart, as in the service: the dispatcher starting the session,
 * the session not seen yet, the session up and silent, then its first answer.
 */
export function startStages(before: EvenKeelState, after: EvenKeelState, project: string): EvenKeelState[] {
  const chain = chainIn(after, project)
  const current = chain?.current
  if (chain === undefined || current == null || current.sessionId === null) return [after]
  const prior = chainIn(before, project)?.current
  const replaced = prior?.task === current.task ? prior.sessionId : null
  const fresh = after.sessions.find((view) => view.sessionId === current.sessionId && view.task === current.task)
  if (fresh === undefined) return [after]
  const silent: SessionView = { ...fresh, startedAt: ago(0), contextTokens: 0, cache: null, action: null, feed: fresh.feed.slice(0, 1) }
  const withSession = (view: SessionView) => after.sessions.map((each) => (each === fresh ? view : each))
  return [
    {
      ...withChain(after, chain, { ...chain, current: { ...current, sessionId: replaced, starting: ago(0) } }),
      sessions: before.sessions,
      taskSessions: before.taskSessions,
    },
    { ...after, sessions: before.sessions },
    { ...after, sessions: withSession(silent) },
    { ...after, sessions: withSession({ ...silent, contextTokens: 12_000, feed: fresh.feed }) },
  ]
}

export function closeCurrent(state: EvenKeelState): EvenKeelState {
  const project = state.chain.active[0]?.project
  return project === undefined ? state : takeNext(finishCurrent(state), project)
}

/** The first half of a close: the current task is done and leaves the chain, nothing is taken yet. */
export function finishCurrent(state: EvenKeelState): EvenKeelState {
  const active = state.chain.active[0]
  const done = active?.current?.task
  const project = active?.project
  if (done === undefined || project === undefined) return state
  const kept = state.chain.projects[project] ?? { order: [], waiting: [], backlog: [], error: null }
  const moved = withChain(state, active!, { ...active!, current: null })
  return {
    ...state,
    tasks: state.tasks.map((each) => (each.id === done ? { ...each, status: { name: 'Done', category: 'Won' as const } } : each)),
    chain: {
      ...moved.chain,
      projects: { ...state.chain.projects, [project]: { ...kept, order: kept.order.filter((id) => id !== done), error: null } },
    },
    sessions: state.sessions.map((view) => (view.task === done ? { ...view, lamp: 'finished' as const } : view)),
  }
}

/** The second half: the chain takes its first task and a new task enters third. */
export function takeNext(state: EvenKeelState, project: string): EvenKeelState {
  const active = chainIn(state, project)
  const kept = state.chain.projects[project]
  if (active === undefined || kept === undefined) return state
  const fresh = freshTask(state, project)
  const order = [...kept.order]
  order.splice(2, 0, fresh.id)
  const next = order[0]
  const since = ago(0)
  const moved = withChain(state, active, { ...active, current: next === undefined ? null : { task: next, sessionId: session(next, 0).sessionId, since } })
  return {
    ...state,
    tasks: [...state.tasks, fresh],
    chain: {
      ...moved.chain,
      projects: { ...state.chain.projects, [project]: { ...kept, order } },
    },
    sessions: [
      ...state.sessions,
      ...(next === undefined || state.sessions.some((view) => view.task === next) ? [] : [session(next, 12_000)]),
    ],
    taskSessions:
      next === undefined
        ? state.taskSessions
        : { ...state.taskSessions, [next]: [{ sessionId: session(next, 0).sessionId, at: since, how: 'launch', resumed: 0, answers: 0 }, ...(state.taskSessions[next] ?? [])] },
  }
}

/** A task that shows up in the chain with each close, so the page has an entry to mark. */
function freshTask(state: EvenKeelState, project: string): ProjectTask {
  const count = state.tasks.filter((each) => each.project === project).length
  const number = 100 + count
  const milestone = state.tasks.find((each) => each.id === state.chain.projects[project]?.order[1])?.milestone?.label ?? null
  return task(`${project}-${number}`, FRESH_TITLES[count % FRESH_TITLES.length]!, 'Todo', 'ToDo', [], milestone, { estimate: minutes(20) })
}

export function setPaused(state: EvenKeelState, project: string, paused: boolean): EvenKeelState {
  const active = chainIn(state, project)
  if (active === undefined) return state
  return withChain(state, active, { ...active, paused, error: paused ? active.error : null })
}

function setStopAfter(state: EvenKeelState, project: string, on: boolean): EvenKeelState {
  const active = chainIn(state, project)
  if (active === undefined) return state
  const { stopAfter: _, ...rest } = active
  return withChain(state, active, on ? { ...rest, stopAfter: true } : rest)
}

function stopChain(state: EvenKeelState, project: string, launches: LaunchEntry[]): EvenKeelState {
  const active = chainIn(state, project)
  if (active === undefined) return state
  const [next, ...rest] = state.chain.queue
  const stopped = withChain(state, active, null)
  return next === undefined ? stopped : startChain({ ...stopped, chain: { ...stopped.chain, queue: rest } }, next, launches)
}

export function startChain(state: EvenKeelState, project: string, launches: LaunchEntry[]): EvenKeelState {
  if (!state.projects.includes(project)) throw fail('chain.unknownProject', { project })
  const { active, queue } = state.chain
  if (chainIn(state, project) !== undefined || queue.includes(project)) return state
  if (active.length >= state.chain.parallel) return { ...state, chain: { ...state.chain, queue: [...queue, project] } }
  const first = state.chain.projects[project]?.order[0]
  if (first === undefined) return state
  const since = ago(0)
  const { sessionId } = session(first, 0)
  launches.push({ at: since, project, task: first, sessionId })
  return {
    ...state,
    chain: { ...state.chain, active: [...active, { project, current: { task: first, sessionId, since }, paused: false, error: null }] },
    sessions: [...state.sessions.filter((view) => view.task !== first), session(first, 12_000)],
    launches: launchDays(launches, new Date(), LAUNCH_DAYS),
    taskSessions: { ...state.taskSessions, [first]: [{ sessionId, at: since, how: 'launch', resumed: 0, answers: 0 }, ...(state.taskSessions[first] ?? [])] },
  }
}

function requeue(state: EvenKeelState, order: string[]): EvenKeelState {
  const queue = state.chain.queue
  if (order.length !== queue.length || !order.every((key) => queue.includes(key))) {
    throw fail('chain.queueChanged', { queue })
  }
  return { ...state, chain: { ...state.chain, queue: [...order] } }
}

function reorder(state: EvenKeelState, project: string, order: string[]): EvenKeelState {
  const tasks = state.tasks.filter((task) => task.id.startsWith(`${project}-`) && order.includes(task.id))
  checkOrder(tasks, order)
  const current = chainIn(state, project)?.current?.task
  const kept = state.chain.projects[project] ?? { waiting: [], backlog: [] }
  const holding = [...(state.chain.skipped[project] ?? []), ...kept.waiting]
  if (current !== undefined && !isOwnName(current) && startsAhead(tasks, order, current, holding)) throw fail('chain.currentFirst', { task: current })
  return { ...state, chain: { ...state.chain, projects: { ...state.chain.projects, [project]: { ...kept, order: [...order], error: null } } } }
}

function skip(state: EvenKeelState, project: string, task: string): EvenKeelState {
  const active = chainIn(state, project)
  const holder = active?.current?.task === task ? active : undefined
  const view = state.sessions.find((each) => each.task === task && each.lamp !== 'finished')
  if (holder !== undefined && (view?.lamp === 'working' || view?.waitingFor != null)) {
    throw fail('chain.midTurn', { task })
  }
  const skipped = state.chain.skipped[project] ?? []
  const released = holder === undefined ? state : withChain(state, holder, { ...holder, current: null })
  if (isOwnName(task)) return released
  return {
    ...state,
    chain: {
      ...released.chain,
      skipped: { ...state.chain.skipped, [project]: skipped.includes(task) ? skipped : [...skipped, task] },
    },
  }
}

function restart(state: EvenKeelState, project: string, task: string, confirmation: unknown): EvenKeelState {
  const active = chainIn(state, project)
  const current = active?.current?.task === task ? active.current : null
  if (active === undefined || current === null) throw fail('chain.notCurrent', { task })
  const view = state.sessions.find((each) => each.task === task)
  if (view === undefined) throw fail('chain.noSession', { task })
  if (current.limit?.resetsAt != null && view.apiErrorKind !== 'transient') {
    const entry = state.account.accounts.find((each) => each.key === view.account)
    throw fail('chain.limitSpent', { until: current.limit.resetsAt, account: entry?.name ?? entry?.status?.email ?? view.account ?? undefined, provider: view.agent })
  }
  const confirmed = restartConfirmation(confirmation)
  if (confirmed !== undefined && (confirmed.sessionId !== view.sessionId || confirmed.since !== view.silentSince)) throw fail('chain.restartChanged', { task })
  if ((view.lamp === 'working' || view.waitingFor !== null) && !silentRestart(view.sessionId, view.silentSince, confirmed, Date.now())) throw fail('chain.midTurn', { task })
  const sessionId = crypto.randomUUID()
  const fresh: SessionView = { ...view, sessionId, lamp: 'working', startupDialog: null, apiError: null, silentSince: null, hungSince: null, lastActivityAt: ago(0), startedAt: ago(0), remoteUrl: 'https://claude.ai/code/session_example', remoteOff: null }
  const rows = (state.taskSessions[task] ?? []).map((row) => (row.sessionId === view.sessionId ? { ...row, replaced: { at: ago(0), how: 'restart' as const } } : row))
  return {
    ...state,
    chain: withChain(state, active, { ...active, current: { task, sessionId, since: current.since } }).chain,
    sessions: state.sessions.map((each) => (each === view ? fresh : each)),
    taskSessions: { ...state.taskSessions, [task]: [{ sessionId, at: ago(0), how: 'restart', resumed: 0, answers: 0 }, ...rows] },
  }
}

function unskip(state: EvenKeelState, project: string, task: string): EvenKeelState {
  const { [project]: skipped = [], ...rest } = state.chain.skipped
  const kept = skipped.filter((id) => id !== task)
  return { ...state, chain: { ...state.chain, skipped: kept.length === 0 ? rest : { ...rest, [project]: kept } } }
}

function dismiss(state: EvenKeelState, project: string, task: string): EvenKeelState {
  const { [project]: leftovers = [], ...rest } = state.chain.leftovers
  const kept = leftovers.filter((each) => each.task !== task)
  return { ...state, chain: { ...state.chain, leftovers: kept.length === 0 ? rest : { ...rest, [project]: kept } } }
}

function dequeue(state: EvenKeelState, project: string): EvenKeelState {
  return { ...state, chain: { ...state.chain, queue: state.chain.queue.filter((key) => key !== project) } }
}

function fakeRefresh(state: EvenKeelState, project: string): EvenKeelState {
  const trackers = state.trackers.map((tracker) => (tracker.projects.includes(project) ? { ...tracker, readAt: { ...tracker.readAt, [project]: ago(0) } } : tracker))
  return { ...state, trackers }
}

export function fakeCommand(state: EvenKeelState, name: string, body: Record<string, unknown>, launches: LaunchEntry[]): EvenKeelState {
  if (name === 'chain/start') return startChain(state, String(body.project), launches)
  if (name === 'chain/resume') return setPaused(state, String(body.project), false)
  if (name === 'chain/stop') return stopChain(state, String(body.project), launches)
  if (name === 'chain/stopAfter') return setStopAfter(state, String(body.project), body.on === true)
  if (name === 'chain/queue') return requeue(state, body.order as string[])
  if (name === 'chain/dequeue') return dequeue(state, String(body.project))
  if (name === 'chain/order') return reorder(state, String(body.project), body.order as string[])
  if (name === 'chain/skip') return skip(state, String(body.project), String(body.task))
  if (name === 'chain/unskip') return unskip(state, String(body.project), String(body.task))
  if (name === 'chain/dismiss') return dismiss(state, String(body.project), String(body.task))
  if (name === 'chain/restart') return restart(state, String(body.project), String(body.task), body.confirmed)
  if (name === 'chain/unattended') return { ...state, unattended: body.on === true }
  if (name === 'chain/trim') return { ...state, trimTools: body.on === true }
  if (name === 'stats/tally') return fakeTally(state, body)
  if (name === 'session/answer') return fakeAnswer(state, body)
  if (name === 'session/mail/dismiss') return fakeDismissMail(state, String(body.sessionId))
  if (name === 'task/ready') return fakeReady(state, String(body.task))
  if (name === 'task/unready') return fakeUnready(state, String(body.task))
  if (name === 'task/milestone') return fakeMoveMilestone(state, String(body.task), body.milestone === null ? null : String(body.milestone))
  if (name === 'chain/refresh') return fakeRefresh(state, String(body.project))
  if (name === 'forward/resolve') return fakeResolve(state, String(body.project))
  const settings =
    fakeCliCommand(state, name, body) ??
    fakeSettingsCommand(state, name, body) ??
    fakeProjectCommand(state, name, body) ??
    fakeUpdatesCommand(state, name) ??
    fakePackagesCommand(state, name, body) ??
    fakeSecretsCommand(state, name, body) ??
    fakeProfilesCommand(state, name, body)
  if (settings !== null) return name === 'settings' ? syncFakeCliSources(settings) : settings
  if (name.startsWith('account/')) return withAccount(state, accountCommand(state.account, name, body))
  throw new Error(`fake: ${name} is not supported`)
}
