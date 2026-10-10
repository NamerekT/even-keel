import {
  loginBlockNotice,
  removeProblem,
  switchProblem,
  type AccountEntry,
  type AccountLogin,
  type AccountView,
  type ClaudeAccount,
} from '../../../src/account/model.js'
import { appSwitchProblem, type AppAccount } from '../../../src/account/apps.js'
import { fail, notice, NoticeError, textNotice } from '../../../src/notice/notice.js'
import type { RateLimits } from '../../../src/limits/model.js'
import type { ActiveChain, LaunchEntry } from '../../../src/chain/dispatcher.js'
import { launchDays } from '../../../src/chain/launches.js'
import { checkOrder } from '../../../src/chain/order.js'
import type { TrackerLinkState, TrackerView } from '../../../src/tracker/health.js'
import { fakeTask as trackerTask } from '../../../src/tracker/fixture.js'
import type { StatusCategory, Task } from '../../../src/tracker/model.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { UsageHealth } from '../../../src/limits/usage.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import { isLanguage } from '../../../src/language.js'
import type { EvenKeelState, SessionRecord, SessionView } from '../../../src/state.js'
import type { Link, LiveSnapshot, LiveSource } from './connection.js'
import { fakeCompare, fakeRuleDiff, fakeRules } from './fakeRules.js'
import { fakeSteps } from './fakeSteps.js'
import { fakeHistory, fakePeriod, fakeTask } from './fakeStats.js'
import { fakeCard, fakeReady } from './fakeCards.js'
import { fakeTools } from './fakeTools.js'

const TICK_MS = 2_000
const ANSWER_MS = 300
const CLOSE_TICKS = 5
const START_STAGE_MS = 3_000
const LAUNCH_DAYS = 14

function task(
  id: string,
  title: string,
  name: string,
  category: StatusCategory,
  blockedBy: string[] = [],
  milestone: string | null = null,
): Task {
  return trackerTask(id, {
    title,
    status: { name, category },
    blockedBy,
    milestone: milestone === null ? null : { label: milestone, targetDate: 0 },
  })
}

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function session(task: string, contextTokens: number, lamp: SessionView['lamp'] = 'working'): SessionView {
  return {
    task,
    sessionId: `00000000-0000-4000-8000-${task.replace(/\D/g, '').padStart(12, '0')}`,
    cwd: 'C:\\repos\\example-project',
    lamp,
    waitingFor: lamp === 'waiting' ? 'permission' : null,
    apiError: null,
    startedAt: ago(42),
    lastActivityAt: ago(0),
    contextTokens,
    cache: fakeCache(lamp),
    tokens: { input: 18_400, output: 9_200, cacheRead: 1_240_000, cacheWrite: 96_000 },
    stage: 'edit',
    action: { at: ago(0), kind: 'tool', text: 'Edit src/example.ts' },
    feed: fakeFeed(),
    remoteUrl: lamp === 'working' || lamp === 'waiting' ? 'https://claude.ai/code/session_example' : null,
    remoteOff: lamp === 'working' || lamp === 'waiting' ? null : 'no-bridge',
    account: task === 'ABC-6' ? 'jane.roe@example.com' : 'john.doe@example.com',
  }
}

function fakeCache(lamp: SessionView['lamp']): SessionView['cache'] {
  if (lamp === 'working') return { ttl: '1h', until: ago(-58) }
  if (lamp === 'waiting') return { ttl: '5m', until: ago(-2) }
  return { ttl: '1h', until: ago(20) }
}

const FEED_STEPS: [FeedLine['kind'], string][] = [
  ['text', 'Читаю описание задачи и вложения.'],
  ['tool', 'huly get_issue ABC-5'],
  ['tool', 'Bash git checkout -b abc-5/chain-order'],
  ['tool', 'Read src/chain/order.ts'],
  ['tool', 'Grep blockedBy'],
  ['text', 'Порядок строится топологической сортировкой, цикл сейчас роняет сервер. Сначала тест на цикл.'],
  ['tool', 'Edit src/chain/order.test.ts'],
  ['tool', 'Bash npx vitest run src/chain'],
  ['tool', 'Edit src/chain/order.ts'],
  ['error', 'API Error: 529 overloaded, повтор через 4 с'],
]

function fakeTranscript(): FeedLine[] {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
  return [
    { at: at(40), kind: 'prompt', text: 'ABC-5\n\nWorking folder: C:\\repos\\example-project\\.claude\\worktrees\\abc-5' },
    { at: at(39), kind: 'text', text: 'Читаю описание задачи и вложения.' },
    { at: at(38), kind: 'tool', text: 'Bash Run the chain tests', detail: 'npx vitest run src/chain\nnpx tsc --noEmit' },
    {
      at: at(30),
      kind: 'text',
      text: 'Порядок строится топологической сортировкой.\n\n- цикл сейчас роняет сервер;\n- сначала тест на цикл, потом правка.\n\n' + 'Длинное объяснение. '.repeat(40),
    },
    { at: at(20), kind: 'prompt', text: 'А почему цикл не ловится раньше?' },
    ...fakeFeed(),
  ]
}

function fakeFeed(): FeedLine[] {
  return Array.from({ length: 30 }, (_, index) => {
    const [kind, text] = FEED_STEPS[index % FEED_STEPS.length]!
    return { at: new Date(Date.now() - (30 - index) * 25_000).toISOString(), kind, text }
  })
}

function fakeHuly(state: TrackerLinkState): TrackerView {
  const view = { name: 'huly', title: 'Huly', projects: ['ABC', 'DEMO', 'XYZ', 'OPS'], ready: true }
  if (state === 'off' || state === 'connecting') return { ...view, health: { state, lastOkAt: null, error: null } }
  if (state === 'down') return { ...view, health: { state, lastOkAt: ago(4), error: 'huly: call timed out after 15000 ms' } }
  return { ...view, health: { state, lastOkAt: ago(0), error: null } }
}

const LAUNCH_PATTERN: Record<string, number[]> = {
  ABC: [2, 1, 0, 3, 2, 0, 0, 1, 4, 2, 1, 0, 2, 1],
  DEMO: [0, 1, 2, 0, 0, 0, 1, 0, 0, 1, 2, 1, 0, 1],
  XYZ: [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0],
}

function fakeLaunches(): LaunchEntry[] {
  return Object.entries(LAUNCH_PATTERN).flatMap(([project, counts]) =>
    counts.flatMap((count, index) => {
      const at = new Date()
      at.setDate(at.getDate() - (counts.length - 1 - index))
      at.setHours(10, 0, 0, 0)
      return Array.from({ length: count }, () => ({ at: at.toISOString(), project, task: `${project}-1`, sessionId: 'fake' }))
    }),
  )
}

function fakeState(
  huly: TrackerLinkState,
  idle: boolean,
  contextTokens: number,
  launches: LaunchEntry[],
  account: string | null,
  limit: string | null,
  usage: string | null,
): EvenKeelState {
  const tasks = [
    task('ABC-1', 'Каркас сервера', 'Done', 'Won', [], 'v0.1 — каркас'),
    task('ABC-2', 'Чтение задач из трекера', 'Done', 'Won', ['ABC-1'], 'v0.1 — каркас'),
    task('ABC-3', 'Опрос трекера по расписанию', 'Canceled', 'Lost', ['ABC-2'], 'v0.1 — каркас'),
    task('ABC-4', 'Запуск сессий в фоне', 'Done', 'Won', ['ABC-2'], 'v0.1 — каркас'),
    task('ABC-5', 'Цепочка задач по связям', 'In Progress', 'Active', ['ABC-4'], 'v0.1 — каркас'),
    task('ABC-6', 'Страница проекта', 'In Progress', 'Active', [], 'v0.1 — каркас'),
    task('ABC-7', 'Разбор транскриптов сессий', 'In Progress', 'Active', ['ABC-6'], 'v0.1 — каркас'),
    task('ABC-8', 'Лимиты подписки в шапке', 'In Progress', 'Active', [], 'v0.1 — каркас'),
    task('ABC-9', 'Журнал запусков', 'In Progress', 'Active', ['ABC-7'], 'v0.1 — каркас'),
    task('ABC-10', 'Очередь цепочек', 'Todo', 'ToDo', [], 'v0.2 — удобство'),
    task('ABC-11', 'Панель сессии', 'Todo', 'ToDo', ['ABC-8', 'ABC-10'], 'v0.2 — удобство'),
    { ...task('ABC-12', 'Вопрос: служба Windows или планировщик задач', 'Todo', 'ToDo'), question: true },
    { ...task('ABC-13', 'Уведомления на телефон', 'Todo', 'ToDo', ['ABC-6'], 'v0.2 — удобство'), question: true },
    task('ABC-14', 'Установка службы одним скриптом', 'Todo', 'ToDo', ['ABC-11'], 'v0.3 — служба'),
    task('ABC-15', 'Перезапуск службы после обновления', 'Todo', 'ToDo', ['ABC-14'], 'v0.3 — служба'),
    task('ABC-18', 'Тёмная тема для печати', 'Backlog', 'UnStarted', [], 'v0.2 — удобство'),
    task('ABC-19', 'Импорт задач из CSV', 'Backlog', 'UnStarted', [], 'v0.3 — служба'),
    task('ABC-20', 'Подсказки по горячим клавишам', 'Backlog', 'UnStarted'),
    task('DEMO-6', 'Старый формат отчёта', 'Canceled', 'Lost'),
    task('DEMO-7', 'Импорт настроек', 'Todo', 'ToDo'),
    task('DEMO-8', 'Экспорт отчёта в CSV', 'Todo', 'ToDo', ['DEMO-7']),
    task('OPS-1', 'Резервное копирование', 'Done', 'Won'),
    task('OPS-2', 'Ротация логов службы', 'Todo', 'ToDo'),
    task('OPS-3', 'Проверка свободного места на диске перед запуском', 'Todo', 'ToDo', ['OPS-2']),
  ]
  return {
    startedAt: ago(180),
    projects: ['ABC', 'DEMO', 'XYZ', 'OPS'],
    chain: {
      active: idle
        ? []
        : [
            {
              project: 'ABC',
              current: { task: 'ABC-5', sessionId: session('ABC-5', 0).sessionId, since: ago(42), ...fakeLimit(limit) },
              paused: false,
              error: null,
            },
          ],
      parallel: 1,
      queue: idle ? [] : ['DEMO', 'OPS'],
      projects: {
        ABC: {
          order: ['ABC-5', 'ABC-6', 'ABC-7', 'ABC-8', 'ABC-9', 'ABC-10', 'ABC-11', 'ABC-13', 'ABC-14', 'ABC-15', 'ABC-12'],
          waiting: [],
          backlog: ['ABC-18', 'ABC-19', 'ABC-20'],
          landing: { 'ABC-18': 'ABC-13', 'ABC-19': 'ABC-15', 'ABC-20': null },
          error: null,
        },
        DEMO: { order: ['DEMO-7', 'DEMO-8'], waiting: [], backlog: [], error: null },
        XYZ: { order: [], waiting: [], backlog: [], error: null },
        OPS: { order: ['OPS-2', 'OPS-3'], waiting: [], backlog: [], error: null },
      },
      skipped: {},
      leftovers: {},
    },
    tasks,
    sessions: idle
      ? []
      : [
          session('ABC-4', 212_000, 'finished'),
          limit === null ? session('ABC-5', contextTokens) : limitedSession(session('ABC-5', contextTokens, 'limit')),
          session('ABC-6', 96_000, 'waiting'),
          session('ABC-7', 188_000, 'error'),
          session('ABC-8', 74_000, 'limit'),
          session('ABC-9', 350_000, 'finished'),
          session('DEMO-7', 142_000, 'waiting'),
        ],
    limits: FAKE_LIMITS,
    usage: fakeUsage(usage),
    account: fakeAccount(account, idle, FAKE_LIMITS),
    trackers: [fakeHuly(huly)],
    trackerUrls: { default: 'https://huly.example.com/workbench/example/tracker/{id}', projects: {} },
    launches: launchDays(launches, new Date(), LAUNCH_DAYS),
    taskSessions: idle
      ? {}
      : {
          'ABC-5': [
            { sessionId: session('ABC-5', 0).sessionId, at: ago(42), how: 'relay', resumed: 0 },
            { sessionId: '00000000-0000-4000-8000-000000000105', at: ago(400), how: 'launch', resumed: 1 },
          ],
          'ABC-4': [{ sessionId: session('ABC-4', 0).sessionId, at: ago(900), how: 'launch', resumed: 0 }],
          'ABC-6': [{ sessionId: session('ABC-6', 0).sessionId, at: ago(60), how: 'manual', resumed: 0 }],
        },
    context: { window: 600_000, warn: 50, danger: 80 },
    configError: null,
    mcpMissing: [],
    language: null,
    unattended: false,
    trimTools: true,
  }
}

function fakeLimit(kind: string | null): { limit: LimitHold } | Record<string, never> {
  if (kind !== 'relay' && kind !== 'resume' && kind !== 'unknown') return {}
  const resetsAt = kind === 'unknown' ? null : new Date(Date.now() + 95 * 60_000).toISOString()
  return {
    limit: { at: ago(3), account: 'john@example.com', resetsAt, lastReplyAt: ago(4), then: kind === 'resume' ? 'resume' : 'relay', acted: null },
  }
}

function limitedSession(view: SessionView): SessionView {
  return { ...view, apiError: "You've hit your session limit · resets 7:20pm (Europe/Berlin)", lastActivityAt: ago(3) }
}

function fakeRecord(state: EvenKeelState, sessionId: string): SessionRecord | null {
  if (sessionId.endsWith('999')) return null
  const live = state.sessions.find((view) => view.sessionId === sessionId)
  return {
    sessionId,
    startedAt: live?.startedAt ?? ago(400),
    lastActivityAt: live?.lastActivityAt ?? ago(250),
    contextTokens: live?.contextTokens ?? 271_000,
    tokens: live?.tokens ?? { input: 192, output: 78_000, cacheRead: 17_400_000, cacheWrite: 243_000 },
    stage: 'test',
    feed: [...fakeFeed(), ...fakeFeed()],
    workdir: 'C:\\repos\\example-project\\.claude\\worktrees\\abc-5',
    branch: 'abc-5/chain-order',
    apiError: live?.apiError ?? "You've hit your session limit · resets 7:20pm (Europe/Berlin)",
  }
}

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
function startStages(before: EvenKeelState, after: EvenKeelState, project: string): EvenKeelState[] {
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

function closeCurrent(state: EvenKeelState): EvenKeelState {
  const active = state.chain.active[0]
  const done = active?.current?.task
  const project = active?.project
  if (done === undefined || project === undefined) return state
  const kept = state.chain.projects[project] ?? { order: [], waiting: [], backlog: [], error: null }
  const order = kept.order.filter((id) => id !== done)
  const next = order[0]
  const since = ago(0)
  const moved = withChain(state, active!, { ...active!, current: next === undefined ? null : { task: next, sessionId: session(next, 0).sessionId, since } })
  return {
    ...state,
    tasks: state.tasks.map((each) => (each.id === done ? { ...each, status: { name: 'Done', category: 'Won' } } : each)),
    chain: {
      ...moved.chain,
      projects: { ...state.chain.projects, [project]: { ...kept, order, error: null } },
    },
    sessions: [
      ...state.sessions.map((view) => (view.task === done ? { ...view, lamp: 'finished' as const } : view)),
      ...(next === undefined || state.sessions.some((view) => view.task === next) ? [] : [session(next, 12_000)]),
    ],
    taskSessions:
      next === undefined
        ? state.taskSessions
        : { ...state.taskSessions, [next]: [{ sessionId: session(next, 0).sessionId, at: since, how: 'launch', resumed: 0 }, ...(state.taskSessions[next] ?? [])] },
  }
}

function setPaused(state: EvenKeelState, project: string, paused: boolean): EvenKeelState {
  const active = chainIn(state, project)
  if (active === undefined) return state
  return withChain(state, active, { ...active, paused, error: paused ? active.error : null })
}

function stopChain(state: EvenKeelState, project: string, launches: LaunchEntry[]): EvenKeelState {
  const active = chainIn(state, project)
  if (active === undefined) return state
  const [next, ...rest] = state.chain.queue
  const stopped = withChain(state, active, null)
  return next === undefined ? stopped : startChain({ ...stopped, chain: { ...stopped.chain, queue: rest } }, next, launches)
}

function startChain(state: EvenKeelState, project: string, launches: LaunchEntry[]): EvenKeelState {
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
    taskSessions: { ...state.taskSessions, [first]: [{ sessionId, at: since, how: 'launch', resumed: 0 }, ...(state.taskSessions[first] ?? [])] },
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
  if (current !== undefined && order[0] !== current) throw fail('chain.currentFirst', { task: current })
  const kept = state.chain.projects[project] ?? { waiting: [], backlog: [] }
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
  return {
    ...state,
    chain: {
      ...released.chain,
      skipped: { ...state.chain.skipped, [project]: skipped.includes(task) ? skipped : [...skipped, task] },
    },
  }
}

function restart(state: EvenKeelState, project: string, task: string): EvenKeelState {
  const active = chainIn(state, project)
  const current = active?.current?.task === task ? active.current : null
  if (active === undefined || current === null) throw fail('chain.notCurrent', { task })
  const view = state.sessions.find((each) => each.task === task)
  if (view === undefined) throw fail('chain.noSession', { task })
  if (view.lamp === 'working' || view.waitingFor !== null) throw fail('chain.midTurn', { task })
  const sessionId = crypto.randomUUID()
  const fresh: SessionView = { ...view, sessionId, lamp: 'working', apiError: null, startedAt: ago(0), remoteUrl: 'https://claude.ai/code/session_example', remoteOff: null }
  const rows = (state.taskSessions[task] ?? []).map((row) => (row.sessionId === view.sessionId ? { ...row, replaced: { at: ago(0), how: 'restart' as const } } : row))
  return {
    ...state,
    chain: withChain(state, active, { ...active, current: { task, sessionId, since: current.since } }).chain,
    sessions: state.sessions.map((each) => (each === view ? fresh : each)),
    taskSessions: { ...state.taskSessions, [task]: [{ sessionId, at: ago(0), how: 'restart', resumed: 0 }, ...rows] },
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

const FAKE_ACCOUNT: ClaudeAccount = {
  loggedIn: true,
  authMethod: 'claude.ai',
  email: 'john.doe@example.com',
  orgName: 'Example Org',
  subscriptionType: 'max',
}

const FAKE_LOGIN: AccountLogin = {
  target: null,
  startedAt: ago(1),
  urls: ['https://claude.example.com/oauth/authorize?code=true&state=example'],
  output: "Browser didn't open? Use the url below to sign in:\n\nhttps://claude.example.com/oauth/authorize?code=true&state=example",
  error: null,
  codeSent: false,
}

function fakeUsage(mode: string | null): UsageHealth {
  if (mode === 'unread') return { state: 'unread', reason: notice('usage.noWeek', {}), since: ago(12) }
  if (mode === 'off') return { state: 'off', reason: notice('usage.turns', { value: '1' }), since: ago(3) }
  if (mode === 'waiting') return { state: 'waiting', reason: null, since: null }
  return { state: 'ok', reason: null, since: ago(60) }
}

const FAKE_LIMITS: RateLimits = {
  fiveHour: { usedPercentage: 37, resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() },
  sevenDay: { usedPercentage: 64, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
  updatedAt: ago(0),
  source: 'usage',
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

function fakeEntry(patch: Partial<AccountEntry>): AccountEntry {
  return {
    key: 'global',
    global: true,
    status: FAKE_ACCOUNT,
    error: null,
    loginExpiresAt: inDays(24),
    needsLogin: false,
    sessions: [],
    removing: false,
    configPending: false,
    limits: null,
    usage: { state: 'ok', reason: null, since: ago(1) },
    ...patch,
  }
}

function fakeAccount(mode: string | null, idle: boolean, limits: RateLimits): AccountView {
  const global = fakeEntry({ limits, sessions: idle ? [] : ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5', 'Scratch notes'] })
  const work = fakeEntry({
    key: 'jane.roe',
    global: false,
    status: { ...FAKE_ACCOUNT, email: 'jane.roe@example.com', subscriptionType: 'pro' },
    loginExpiresAt: inDays(5),
    usage: { state: 'stale', reason: null, since: ago(30) },
  })
  const vscode: AppAccount = { app: 'vscode', account: 'jane.roe', dir: 'C:\\Users\\john\\.claude-accounts\\jane.roe', error: null, sessions: [] }
  const signedIn: AccountView = {
    active: 'global',
    accounts: [global, work],
    apps: [vscode],
    login: null,
    loginBlock: idle
      ? null
      : {
          chains: ['ABC'],
          sessions: [
            { name: 'ABC-5', status: 'busy', waitingFor: null },
            { name: 'Scratch notes', status: 'waiting', waitingFor: 'permission' },
          ],
        },
  }
  if (mode === 'out') {
    const out = { ...global, status: { loggedIn: false, authMethod: 'none', email: null, orgName: null, subscriptionType: null }, needsLogin: true }
    return { ...signedIn, accounts: [out, work] }
  }
  if (mode === 'expired') return { ...signedIn, accounts: [{ ...global, loginExpiresAt: ago(60), needsLogin: true, limits: null }, work] }
  if (mode === 'login') return { ...signedIn, login: FAKE_LOGIN, loginBlock: null }
  if (mode === 'failed') {
    return { ...signedIn, login: { ...FAKE_LOGIN, error: notice('login.exited', { code: '1' }, { detail: 'OAuth error' }) }, loginBlock: null }
  }
  if (mode === 'unknown') return { ...signedIn, accounts: [{ ...global, status: null, error: textNotice('claude: auth status timed out') }, work] }
  const workSessions = ['ABC-7', 'ABC-8']
  if (mode === 'pending') return { ...signedIn, accounts: [global, { ...work, sessions: workSessions, configPending: true }] }
  if (mode === 'removing') return { ...signedIn, accounts: [global, { ...work, sessions: workSessions, removing: true }] }
  if (mode === 'vscode-chats') {
    const sessions = [
      { name: 'example-12', status: 'busy' as const },
      { name: 'Scratch', status: 'idle' as const },
    ]
    return { ...signedIn, apps: [{ ...vscode, sessions }] }
  }
  if (mode === 'many') {
    const window = (usedPercentage: number, hours: number) => ({ usedPercentage, resetsAt: new Date(Date.now() + hours * 3_600_000).toISOString() })
    const spare = (key: string, fiveHour: number, week: number) =>
      fakeEntry({
        key,
        global: false,
        status: { ...FAKE_ACCOUNT, email: `${key}@example.com`, subscriptionType: 'pro' },
        loginExpiresAt: inDays(25),
        sessions: ['ABC-9'],
        limits: { ...limits, fiveHour: window(fiveHour, 2.8), sevenDay: window(week, 100) },
      })
    const spent = { ...global, limits: { ...limits, fiveHour: null, sevenDay: window(100, 10.5) } }
    return { ...signedIn, active: 'jane.roe', accounts: [spent, work, spare('richard.roe', 96, 36), spare('baby.doe', 99, 14)] }
  }
  if (mode === 'vscode-broken') {
    return { ...signedIn, apps: [{ ...vscode, account: null, dir: null, error: notice('vscode.notJson', {}) }] }
  }
  return signedIn
}

function accountCommand(account: AccountView, name: string, body: Record<string, unknown>): AccountView {
  const key = String(body.account)
  if (name === 'account/add' || name === 'account/renew') {
    if (account.login !== null && account.login.error === null) throw fail('login.running', {})
    if (name === 'account/renew' && key === account.active && account.loginBlock !== null) throw new NoticeError(loginBlockNotice(account.loginBlock))
    return { ...account, login: { ...FAKE_LOGIN, target: name === 'account/add' ? null : key, startedAt: ago(0) } }
  }
  if (name === 'account/switch') {
    const problem = switchProblem(account, key)
    if (problem !== undefined) throw new NoticeError(problem)
    return { ...account, active: key }
  }
  if (name === 'account/app') {
    const problem = appSwitchProblem(account, String(body.app), key)
    if (problem !== undefined) throw new NoticeError(problem)
    return { ...account, apps: account.apps.map((app) => (app.app === body.app ? { ...app, account: key } : app)) }
  }
  if (name === 'account/remove') {
    const problem = removeProblem(account, key)
    if (problem !== undefined) throw new NoticeError(problem)
    const busy = account.accounts.some((entry) => entry.key === key && entry.sessions.length > 0)
    if (busy) return { ...account, accounts: account.accounts.map((entry) => (entry.key === key ? { ...entry, removing: true } : entry)) }
    return { ...account, accounts: account.accounts.filter((entry) => entry.key !== key) }
  }
  if (name === 'account/keep') {
    return { ...account, accounts: account.accounts.map((entry) => (entry.key === key ? { ...entry, removing: false } : entry)) }
  }
  if (name === 'account/cancel') return { ...account, login: null }
  if (name === 'account/code') {
    const { login } = account
    if (login === null) throw fail('login.none', {})
    if (String(body.code).trim() === 'fail') {
      return { ...account, login: { ...login, error: notice('login.exited', { code: '1' }, { detail: 'Invalid code' }) } }
    }
    const renewed = { loginExpiresAt: inDays(30), needsLogin: false }
    if (login.target === null) {
      const added = fakeEntry({ key: 'richard.roe', global: false, status: { ...FAKE_ACCOUNT, email: 'richard.roe@example.com' }, ...renewed })
      return { ...account, accounts: [...account.accounts, added], login: null }
    }
    const accounts = account.accounts.map((entry) =>
      entry.key === login.target ? { ...entry, ...renewed, status: entry.status ?? FAKE_ACCOUNT } : entry,
    )
    return { ...account, accounts, login: null }
  }
  throw new Error(`fake: ${name} is not supported`)
}

function fakeCommand(state: EvenKeelState, name: string, body: Record<string, unknown>, launches: LaunchEntry[]): EvenKeelState {
  if (name === 'chain/start') return startChain(state, String(body.project), launches)
  if (name === 'chain/resume') return setPaused(state, String(body.project), false)
  if (name === 'chain/stop') return stopChain(state, String(body.project), launches)
  if (name === 'chain/queue') return requeue(state, body.order as string[])
  if (name === 'chain/dequeue') return dequeue(state, String(body.project))
  if (name === 'chain/order') return reorder(state, String(body.project), body.order as string[])
  if (name === 'chain/skip') return skip(state, String(body.project), String(body.task))
  if (name === 'chain/unskip') return unskip(state, String(body.project), String(body.task))
  if (name === 'chain/dismiss') return dismiss(state, String(body.project), String(body.task))
  if (name === 'chain/restart') return restart(state, String(body.project), String(body.task))
  if (name === 'chain/unattended') return { ...state, unattended: body.on === true }
  if (name === 'chain/trim') return { ...state, trimTools: body.on === true }
  if (name === 'task/ready') return fakeReady(state, String(body.task))
  if (name.startsWith('account/')) return { ...state, account: accountCommand(state.account, name, body) }
  throw new Error(`fake: ${name} is not supported`)
}

function isLink(value: string | null): value is Link {
  return value === 'connecting' || value === 'live' || value === 'stale'
}

function isHulyState(value: string | null): value is TrackerLinkState {
  return value === 'off' || value === 'connecting' || value === 'live' || value === 'down'
}

export function createFakeSource(search: string): LiveSource {
  const params = new URLSearchParams(search)
  const requested = params.get('link')
  const link: Link = isLink(requested) ? requested : 'live'
  const requestedHuly = params.get('huly')
  const huly: TrackerLinkState = isHulyState(requestedHuly) ? requestedHuly : 'live'
  const listeners = new Set<() => void>()
  const launches = fakeLaunches()
  const idle = params.get('chain') === 'idle'
  const contextTokens = Number(params.get('ctx') ?? 61_000)
  const delay = params.has('delay') ? Number(params.get('delay')) : null
  const answer = () => new Promise((resolve) => setTimeout(resolve, delay ?? ANSWER_MS))
  let current: LiveSnapshot = {
    state: link === 'connecting' ? null : fakeState(huly, idle, contextTokens, launches, params.get('account'), params.get('limit'), params.get('usage')),
    link,
  }
  const language = params.get('lang')
  if (isLanguage(language) && current.state !== null) current.state.language = language
  if (params.get('config') === 'broken' && current.state !== null) {
    current.state.configError = notice('config.statusBoth', { project: 'ABC', status: 'In Review' })
  }
  if (params.get('mcp') === 'missing' && current.state !== null) {
    current.state.mcpMissing = [
      { project: 'ABC', server: 'huly' },
      { project: 'XYZ', server: 'huly' },
    ]
  }
  const active = current.state?.chain.active[0]
  if (params.get('chain') === 'limit' && active) {
    current.state!.chain.active = [{ ...active, current: null, limitUntil: new Date(Date.now() + 95 * 60_000).toISOString() }]
  }
  if (params.get('chain') === 'slot' && active) {
    const dirty = notice('slot.dirty', { path: 'D:/work/abc/.claude/worktrees/even-keel' }, { detail: 'M src/app.ts\n?? src/scratch.ts' })
    const slotWait = { notice: notice('slot.waiting', { task: 'ABC-12' }, { items: [dirty] }), at: new Date().toISOString() }
    current.state!.chain.active = [{ ...active, current: null, slotWait }]
  }
  const parallel = Number(params.get('parallel') ?? 1)
  if (parallel > 1 && current.state !== null) {
    current.state = startChain({ ...current.state, chain: { ...current.state.chain, parallel, queue: current.state.chain.queue.slice(1) } }, 'DEMO', launches)
  }
  if (params.get('chain') === 'backlog' && current.state !== null) {
    const { tasks, chain } = current.state
    current.state.tasks = [
      ...tasks.map((each) => (each.id === 'ABC-10' ? { ...each, blockedBy: ['ABC-16'] } : each)),
      task('ABC-16', 'Схема базы статистики', 'Backlog', 'UnStarted', ['ABC-17']),
      task('ABC-17', 'Выбор хранилища', 'Backlog', 'UnStarted'),
    ]
    chain.projects['ABC'] = { ...chain.projects['ABC']!, waiting: ['ABC-16', 'ABC-17'] }
  }
  if (params.get('chain') === 'skip' && current.state !== null) {
    current.state.chain.skipped = { ABC: ['ABC-12'] }
    current.state.taskSessions['ABC-9'] = [
      {
        sessionId: session('ABC-9', 0).sessionId,
        at: ago(300),
        how: 'launch',
        resumed: 0,
        left: { at: ago(280), reason: 'postpone', blockers: ['ABC-7'] },
      },
    ]
  }
  if (params.get('chain') === 'leftover' && current.state !== null) {
    current.state.chain.leftovers = {
      ABC: [
        {
          task: 'ABC-4',
          at: ago(35),
          notice: notice(
            'cleanup.worktreeKept',
            { path: 'D:\\work\\abc\\.claude\\worktrees\\abc-4' },
            { detail: "fatal: '.claude/worktrees/abc-4' contains modified or untracked files, use --force to delete it" },
          ),
        },
        {
          task: 'ABC-3',
          at: ago(90),
          notice: notice('cleanup.branchKept', { branch: 'abc-3/task' }, { detail: "error: the branch 'abc-3/task' is not fully merged" }),
        },
        { task: 'ABC-2', at: ago(120), notice: textNotice('ABC-2: the worktree was kept (an entry saved before BTN-62)') },
      ],
    }
  }
  if (params.get('chain') === 'restart' && current.state !== null && active) {
    const stalled: SessionView = {
      ...session('ABC-5', contextTokens, 'limit'),
      apiError: 'Usage limit reached: Claude Code told the session to wrap up the turn',
      remoteUrl: null,
      remoteOff: 'lost',
    }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? stalled : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: stalled.sessionId, since: ago(42) } }]
  }
  if (params.get('chain') === 'checkpoint' && current.state !== null && active?.current) {
    const { task, sessionId } = active.current
    current.state.taskSessions[task] = [
      { sessionId: sessionId ?? crypto.randomUUID(), at: ago(20), how: 'checkpoint', resumed: 0 },
      { sessionId: crypto.randomUUID(), at: ago(70), how: 'checkpoint', resumed: 0, replaced: { at: ago(20), how: 'checkpoint' } },
      { sessionId: crypto.randomUUID(), at: ago(150), how: 'launch', resumed: 0, replaced: { at: ago(70), how: 'checkpoint' } },
    ]
  }
  const notify = () => {
    for (const listener of listeners) listener()
  }

  const closing = params.get('chain') === 'close'
  let ticks = 0

  if (link === 'live') {
    setInterval(() => {
      const state = closing && ++ticks % CLOSE_TICKS === 0 ? closeCurrent(current.state!) : current.state!
      const sessions = state.sessions.map((view) =>
        view.lamp === 'working' && view.contextTokens > 0
          ? {
              ...view,
              contextTokens: view.contextTokens + 800,
              lastActivityAt: ago(0),
              feed: [...view.feed.slice(1), { at: ago(0), kind: 'tool' as const, text: `Read src/example-${Date.now() % 1000}.ts` }],
            }
          : view,
      )
      const trackers = state.trackers.map((tracker) =>
        tracker.health.state === 'live' ? { ...tracker, health: { ...tracker.health, lastOkAt: ago(0) } } : tracker,
      )
      current = { ...current, state: { ...state, sessions, trackers } }
      notify()
    }, TICK_MS)
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot: () => current,
    retryNow: () => {},
    command: async (name, body = {}) => {
      const state = current.state
      if (state === null) throw new Error('fake: no state yet')
      const next = fakeCommand(state, name, body, launches)
      const stages = name === 'chain/start' || name === 'chain/restart' ? startStages(state, next, String(body.project)) : [next]
      stages.forEach((stage, index) => {
        const show = () => {
          current = { ...current, state: stage }
          notify()
        }
        if (index === 0) show()
        else setTimeout(show, index * (delay ?? START_STAGE_MS))
      })
    },
    session: async (sessionId) => {
      await answer()
      return current.state === null ? null : fakeRecord(current.state, sessionId)
    },
    transcript: async (sessionId, after) => {
      await new Promise((resolve) => setTimeout(resolve, ANSWER_MS))
      if (sessionId.endsWith('999')) return null
      if (after === 0) return fakeTranscript()
      return [{ at: ago(0), kind: 'tool', text: `Read src/example-${Date.now() % 1000}.ts` }]
    },
    tools: async (project) => {
      await answer()
      return current.state?.projects.includes(project) ? fakeTools(project, current.state.trimTools, params.get('tools')) : null
    },
    card: async (task) => {
      await answer()
      return current.state === null ? null : fakeCard(current.state, task, params.get('card'))
    },
    statsHistory: async (filter) => {
      await answer()
      return fakeHistory(params.get('stats'), filter)
    },
    statsPeriod: async (query) => {
      await answer()
      return fakePeriod(params.get('stats'), query)
    },
    statsSteps: async (query) => {
      await answer()
      return fakeSteps(params.get('stats'), query)
    },
    statsTask: async (task) => {
      await answer()
      return fakeTask(params.get('stats'), task)
    },
    statsRules: async (query) => {
      await answer()
      return fakeRules(params.get('stats'), params.get('rules'), query)
    },
    statsRuleDiff: async (changes) => {
      await answer()
      return fakeRuleDiff(params.get('stats'), changes)
    },
    statsCompare: async (query) => {
      await answer()
      return fakeCompare(params.get('stats'), params.get('rules'), query)
    },
  }
}
