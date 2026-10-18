import { fail, notice, textNotice } from '../../../src/notice/notice.js'
import type { ActiveChain, LaunchEntry } from '../../../src/chain/dispatcher.js'
import { fixName, isFixName } from '../../../src/chain/fix.js'
import { launchDays } from '../../../src/chain/launches.js'
import { checkOrder } from '../../../src/chain/order.js'
import type { TrackerLinkState, TrackerView } from '../../../src/tracker/health.js'
import { fakeTask as trackerTask } from '../../../src/tracker/fixture.js'
import type { StatusCategory, Task } from '../../../src/tracker/model.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import { isLanguage } from '../../../src/language.js'
import type { EvenKeelState, SessionRecord, SessionView } from '../../../src/state.js'
import type { Link, LiveSnapshot, LiveSource } from './connection.js'
import { deviceLogin } from '../accounts.js'
import { accountCommand, fakeAccount, fakeUsage, FAKE_LIMITS } from './fakeAccounts.js'
import { FAKE_FIX, fakeCi } from './fakeCi.js'
import { fakeUpdates, fakeUpdatesCommand } from './fakeUpdates.js'
import { FAKE_PROJECT_IDS, fakeConfig, fakeHandEdit, fakeRestart, fakeSettingsCommand } from './fakeConfig.js'
import { withFix } from './fakeFix.js'
import { fakeCompare, fakeRuleDiff, fakeRules } from './fakeRules.js'
import { fakeSteps } from './fakeSteps.js'
import { fakeCheckpoints, fakeHistory, fakePeriod, fakeSpend, fakeTask } from './fakeStats.js'
import { fakeCard, fakeMoveMilestone, fakeReady } from './fakeCards.js'
import { fakeAnswer, fakeImageUrl, fakeOpenAsk, fakePastAsk, fakeSentFileUrl, fakeShots, FAKE_ASK, FAKE_UNSAVED_ASK } from './fakeChat.js'
import type { Ask } from '../../../src/sessions/ask.js'
import { fakeTools } from './fakeTools.js'
import { fakePackages, fakePackagesCommand } from './fakePackages.js'

const TICK_MS = 2_000
const ANSWER_MS = 300
const CLOSE_TICKS = 5
const HANDOVER_MS = 1_000
const DEVICE_MS = 8_000
const START_STAGE_MS = 3_000
/** `?config=edited`: time to open the settings and start a draft before the file changes under it. */
const HAND_EDIT_MS = 15_000
const LAUNCH_DAYS = 14

function task(
  id: string,
  title: string,
  name: string,
  category: StatusCategory,
  blockedBy: string[] = [],
  milestone: string | null = null,
  extra: Partial<Task> = {},
): Task {
  return trackerTask(id, {
    title,
    status: { name, category },
    blockedBy,
    milestone: milestone === null ? null : { label: milestone, targetDate: 0 },
    priority: 'medium',
    ...extra,
  })
}

const minutes = (count: number) => count / 60
const REWORK = { labels: ['Переделка'] }

const FRESH_TITLES = ['Сводка за ночь на главной', 'Подсветка новых задач', 'Экспорт журнала запусков', 'Повтор упавшей сессии']

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/** When the turn of every working fake session began: the turn line's clock runs on from it. */
const turnStartedAt = ago(0.4)

function fakeSessionId(task: string): string {
  const [project = '', number = ''] = task.split('-')
  const projectHex = Array.from(project.slice(0, 4), (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  return `${projectHex.padStart(8, '0')}-0000-4000-8000-${number.replace(/\D/g, '').padStart(12, '0')}`
}

function session(task: string, contextTokens: number, lamp: SessionView['lamp'] = 'working'): SessionView {
  return {
    task,
    sessionId: fakeSessionId(task),
    agent: 'claude',
    cwd: 'C:\\repos\\example-project',
    lamp,
    checkpoint: false,
    waitingFor: lamp === 'waiting' && task !== 'ABC-5' ? 'permission' : null,
    startupDialog: null,
    asking: lamp === 'waiting' && task === 'ABC-5',
    ask: lamp === 'waiting' && task === 'ABC-5' ? FAKE_ASK : null,
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

function fakeTranscript(open: Ask | null): FeedLine[] {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
  return [
    { at: at(40), kind: 'prompt', text: 'ABC-5\n\nWorking folder: C:\\repos\\example-project\\.claude\\worktrees\\abc-5' },
    { at: at(39), kind: 'text', text: 'Читаю описание задачи и вложения.' },
    { at: at(38), kind: 'tool', text: 'Bash Run the chain tests', detail: 'npx vitest run src/chain\nnpx tsc --noEmit' },
    ...fakePastAsk(at),
    {
      at: at(30),
      kind: 'text',
      text: 'Порядок строится топологической сортировкой.\n\n- цикл сейчас роняет сервер;\n- сначала тест на цикл, потом правка.\n\n' + 'Длинное объяснение. '.repeat(40),
    },
    ...fakeShots(at),
    { at: at(20), kind: 'prompt', text: 'А почему цикл не ловится раньше?' },
    ...fakeFeed(),
    ...fakeOpenAsk(open),
  ]
}

function fakeFeed(): FeedLine[] {
  return Array.from({ length: 30 }, (_, index) => {
    const [kind, text] = FEED_STEPS[index % FEED_STEPS.length]!
    return { at: new Date(Date.now() - (30 - index) * 25_000).toISOString(), kind, text }
  })
}

function fakeHuly(state: TrackerLinkState): TrackerView {
  const projects = ['ABC', 'DEMO', 'XYZ', 'OPS']
  const view = { name: 'huly', title: 'Huly', projects, ready: true }
  const readAt = (minutes: number) => Object.fromEntries(projects.map((project) => [project, ago(minutes)]))
  if (state === 'off' || state === 'connecting') return { ...view, health: { state, lastOkAt: null, error: null }, readAt: {} }
  if (state === 'down') return { ...view, health: { state, lastOkAt: ago(4), error: 'huly: call timed out after 15000 ms' }, readAt: readAt(4) }
  return { ...view, health: { state, lastOkAt: ago(0), error: null }, readAt: readAt(0) }
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
    task('ABC-5', 'Цепочка задач по связям', 'In Progress', 'Active', ['ABC-4'], 'v0.1 — каркас', { priority: 'high', estimate: minutes(40), parent: 'ABC-16' }),
    task('ABC-6', 'Страница проекта', 'In Progress', 'Active', [], 'v0.1 — каркас', { priority: 'urgent', estimate: minutes(20) }),
    task('ABC-7', 'Разбор транскриптов сессий', 'In Progress', 'Active', ['ABC-6'], 'v0.1 — каркас', { estimate: minutes(80), parent: 'ABC-16' }),
    task('ABC-8', 'Лимиты подписки в шапке', 'In Progress', 'Active', [], 'v0.1 — каркас', { ...REWORK, priority: 'low', estimate: minutes(20) }),
    task('ABC-9', 'Журнал запусков', 'In Progress', 'Active', ['ABC-7'], 'v0.1 — каркас', { estimate: minutes(10), parent: 'ABC-16' }),
    task('ABC-10', 'Очередь цепочек', 'Todo', 'ToDo', [], 'v0.2 — удобство', { estimate: 1.5, parent: 'ABC-17', labels: ['Claude | sonnet'], runLabels: [{ provider: 'claude', model: 'sonnet' }] }),
    task('ABC-11', 'Панель сессии', 'Todo', 'ToDo', ['ABC-8', 'ABC-10'], 'v0.2 — удобство', { estimate: minutes(5), parent: 'ABC-17' }),
    { ...task('ABC-12', 'Вопрос: служба Windows или планировщик задач', 'Todo', 'ToDo', [], null, { priority: 'low' }), question: true },
    { ...task('ABC-13', 'Уведомления на телефон', 'Todo', 'ToDo', ['ABC-6'], 'v0.2 — удобство', { estimate: 3 }), question: true },
    task('ABC-14', 'Установка службы одним скриптом', 'Todo', 'ToDo', ['ABC-11'], 'v0.3 — служба', { priority: 'high', estimate: minutes(40) }),
    task('ABC-15', 'Перезапуск службы после обновления', 'Todo', 'ToDo', ['ABC-14'], 'v0.3 — служба', { ...REWORK, priority: 'low' }),
    task('ABC-18', 'Тёмная тема для печати', 'Backlog', 'UnStarted', [], 'v0.2 — удобство'),
    task('ABC-19', 'Импорт задач из CSV', 'Backlog', 'UnStarted', [], 'v0.3 — служба'),
    task('ABC-20', 'Подсказки по горячим клавишам', 'Backlog', 'UnStarted'),
    task('DEMO-6', 'Старый формат отчёта', 'Canceled', 'Lost'),
    { ...task('DEMO-7', 'Вопрос: какие настройки переносить при импорте', 'Todo', 'ToDo'), question: true },
    task('DEMO-8', 'Экспорт отчёта в CSV', 'Todo', 'ToDo', ['DEMO-7']),
    task('OPS-1', 'Резервное копирование', 'Done', 'Won'),
    task('OPS-2', 'Ротация логов службы', 'Todo', 'ToDo'),
    task('OPS-3', 'Проверка свободного места на диске перед запуском', 'Todo', 'ToDo', ['OPS-2']),
  ]
  return {
    startedAt: ago(180),
    projects: ['ABC', 'DEMO', 'XYZ', 'OPS'],
    projectIds: FAKE_PROJECT_IDS,
    config: fakeConfig(),
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
          limit === null ? session('ABC-5', contextTokens) : limitedSession(session('ABC-5', contextTokens, 'limit'), limit),
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
    ci: fakeCi(null),
    launches: launchDays(launches, new Date(), LAUNCH_DAYS),
    taskSessions: idle
      ? {}
      : {
          'ABC-5': [
            { sessionId: session('ABC-5', 0).sessionId, at: ago(42), how: 'relay', resumed: 0, answers: 0, account: 'john.doe@example.com' },
            { sessionId: '00000000-0000-4000-8000-000000000105', at: ago(400), how: 'launch', resumed: 1, answers: 2, account: 'jane.roe@example.com' },
          ],
          'ABC-4': [{ sessionId: session('ABC-4', 0).sessionId, at: ago(900), how: 'launch', resumed: 0, answers: 0, account: 'john.doe@example.com' }],
          'ABC-6': [{ sessionId: session('ABC-6', 0).sessionId, at: ago(60), how: 'manual', resumed: 0, answers: 0, account: 'jane.roe@example.com' }],
          'ABC-FIX.1': [{ sessionId: '00000000-0000-4000-8000-000000000f01', at: ago(1_400), how: 'launch', resumed: 0, answers: 0, account: 'john.doe@example.com' }],
          'ABC-FIX.2': [{ sessionId: '00000000-0000-4000-8000-000000000f02', at: ago(700), how: 'launch', resumed: 0, answers: 0, account: 'john.doe@example.com' }],
        },
    fixes: idle
      ? {}
      : {
          ABC: [
            { id: 'ABC-FIX.1', red: '5c95521730bbc58ab20052f7ff807c29a8fbeb65', at: ago(1_400), end: { at: ago(1_390), how: 'dropped', commit: null } },
            { id: 'ABC-FIX.2', red: FAKE_FIX.red, at: ago(700), end: { at: ago(680), how: 'landed', commit: FAKE_FIX.landed } },
          ],
        },
    context: { window: 600_000, warn: 50, danger: 80 },
    configError: null,
    packages: fakePackages(['ABC', 'DEMO', 'XYZ', 'OPS'], null),
    language: null,
    unattended: false,
    trimTools: true,
    updates: fakeUpdates(null),
    fallbacks: [],
  }
}

function fakeLimit(kind: string | null): { limit: LimitHold } | Record<string, never> {
  if (kind !== 'relay' && kind !== 'resume' && kind !== 'unknown' && kind !== 'credit') return {}
  const resetsAt = kind === 'unknown' || kind === 'credit' ? null : new Date(Date.now() + 95 * 60_000).toISOString()
  const account = kind === 'credit' ? 'api-work' : 'john@example.com'
  return {
    limit: { at: ago(3), account, resetsAt, lastReplyAt: ago(4), then: kind === 'resume' ? 'resume' : 'relay', acted: null },
  }
}

function limitedSession(view: SessionView, kind: string): SessionView {
  if (kind === 'credit') {
    return { ...view, apiError: 'Credit balance is too low', lastActivityAt: ago(3), remoteUrl: null, remoteOff: 'api-key', account: 'api-work' }
  }
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
    account: live?.account ?? state.taskSessions['ABC-5']?.find((row) => row.sessionId === sessionId)?.account ?? 'jane.roe@example.com',
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
  const project = state.chain.active[0]?.project
  return project === undefined ? state : takeNext(finishCurrent(state), project)
}

/** The first half of a close: the current task is done and leaves the chain, nothing is taken yet. */
function finishCurrent(state: EvenKeelState): EvenKeelState {
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
function takeNext(state: EvenKeelState, project: string): EvenKeelState {
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
function freshTask(state: EvenKeelState, project: string): Task {
  const count = state.tasks.filter((each) => each.id.startsWith(`${project}-`)).length
  const number = 100 + count
  const milestone = state.tasks.find((each) => each.id === state.chain.projects[project]?.order[1])?.milestone?.label ?? null
  return task(`${project}-${number}`, FRESH_TITLES[count % FRESH_TITLES.length]!, 'Todo', 'ToDo', [], milestone, { estimate: minutes(20) })
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
  if (current !== undefined && !isFixName(current) && order[0] !== current) throw fail('chain.currentFirst', { task: current })
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
  if (isFixName(task)) return released
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
  const fresh: SessionView = { ...view, sessionId, lamp: 'working', startupDialog: null, apiError: null, startedAt: ago(0), remoteUrl: 'https://claude.ai/code/session_example', remoteOff: null }
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
  if (name === 'session/answer') return fakeAnswer(state, body)
  if (name === 'task/ready') return fakeReady(state, String(body.task))
  if (name === 'task/milestone') return fakeMoveMilestone(state, String(body.task), body.milestone === null ? null : String(body.milestone))
  if (name === 'chain/refresh') return fakeRefresh(state, String(body.project))
  const settings = fakeSettingsCommand(state, name, body) ?? fakeUpdatesCommand(state, name) ?? fakePackagesCommand(state, name, body)
  if (settings !== null) return settings
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
  if (params.has('ci') && current.state !== null) current.state.ci = fakeCi(params.get('ci'))
  if (params.has('update') && current.state !== null) current.state.updates = fakeUpdates(params.get('update'))
  if (params.get('fallback') === 'on' && current.state !== null) {
    const notice = { code: 'chain.noAccountFor' as const, params: { task: 'ABC-10', label: 'Codex', provider: 'Claude' } }
    current.state.fallbacks = [{ at: new Date().toISOString(), task: 'ABC-10', notice }]
  }
  if (params.get('limits') === 'hot' && current.state !== null) {
    const { fiveHour, sevenDay } = FAKE_LIMITS
    current.state.limits = { ...FAKE_LIMITS, fiveHour: { ...fiveHour!, usedPercentage: 86 }, sevenDay: { ...sevenDay!, usedPercentage: 100 } }
  }
  if (params.get('limits') === 'none' && current.state !== null) current.state.limits = null
  if (params.get('config') === 'broken' && current.state !== null) {
    current.state.configError = notice('config.statusBoth', { project: 'ABC', status: 'In Review' })
  }
  if (params.get('config') === 'restart' && current.state !== null) current.state.config = fakeRestart(current.state.config)
  if (params.has('packages') && current.state !== null) current.state.packages = fakePackages(current.state.projects, params.get('packages'))
  const active = current.state?.chain.active[0]
  if (params.get('chain') === 'limit' && active) {
    current.state!.chain.active = [{ ...active, current: null, limitUntil: new Date(Date.now() + 95 * 60_000).toISOString() }]
  }
  if (params.get('chain') === 'paused' && current.state !== null) current.state = setPaused(current.state, 'ABC', true)
  if (params.get('chain') === 'slot' && active) {
    const dirty = notice('slot.dirty', { path: 'D:/work/abc/.claude/worktrees/even-keel' }, { detail: 'M src/app.ts\n?? src/scratch.ts' })
    const slotWait = { notice: notice('slot.waiting', { task: 'ABC-12' }, { items: [dirty] }), at: new Date().toISOString() }
    current.state!.chain.active = [{ ...active, current: null, slotWait }]
  }
  if ((params.get('chain') === 'ci' || params.get('chain') === 'check' || params.get('chain') === 'afterGreen') && active) {
    const local = params.get('chain') === 'check' ? { local: true as const } : params.get('chain') === 'afterGreen' ? { after: true as const } : {}
    const ciWait = { commit: '9f77142a5c0e3d1b7e6f4a2c8d9b0e1f2a3b4c5d', since: new Date(Date.now() - 4 * 60_000).toISOString(), ...local }
    current.state!.chain.active = [{ ...active, current: null, ciWait }]
  }
  const parallel = Number(params.get('parallel') ?? 1)
  if (parallel > 1 && current.state !== null) {
    current.state = startChain({ ...current.state, chain: { ...current.state.chain, parallel, queue: current.state.chain.queue.slice(1) } }, 'DEMO', launches)
  }
  if (params.get('chain') === 'backlog' && current.state !== null) {
    const { tasks, chain } = current.state
    current.state.tasks = [
      ...tasks.map((each) => (each.id === 'ABC-10' ? { ...each, blockedBy: ['ABC-16', 'ABC-21'] } : each)),
      task('ABC-16', 'Схема базы статистики', 'Backlog', 'UnStarted', ['ABC-17']),
      task('ABC-17', 'Выбор хранилища', 'Backlog', 'UnStarted'),
      task('ABC-21', 'Новая схема ключей', 'Backlog', 'UnStarted', [], 'v0.3 — служба'),
    ]
    const order = chain.projects['ABC']!
    chain.projects['ABC'] = {
      ...order,
      waiting: ['ABC-16', 'ABC-17', 'ABC-21'],
      landing: { ...order.landing, 'ABC-16': 'ABC-10', 'ABC-17': null },
      refused: { 'ABC-21': notice('order.later', { task: 'ABC-10', milestone: 'v0.2 — удобство', blocker: 'ABC-21', blockerMilestone: 'v0.3 — служба' }) },
    }
  }
  if (params.get('chain') === 'later' && current.state !== null) {
    const { tasks, chain } = current.state
    current.state.tasks = [
      ...tasks.map((each) => (each.id === 'ABC-10' ? { ...each, blockedBy: ['ABC-21'] } : each)),
      task('ABC-21', 'Новая схема ключей', 'Todo', 'ToDo', [], 'v0.3 — служба'),
    ]
    const error = notice('order.later', { task: 'ABC-10', milestone: 'v0.2 — удобство', blocker: 'ABC-21', blockerMilestone: 'v0.3 — служба' })
    chain.projects['ABC'] = { ...chain.projects['ABC']!, order: [], waiting: [], error }
    chain.active = chain.active.map((each) => (each.project === 'ABC' ? { ...each, current: null, paused: true, error } : each))
  }
  if (params.get('chain') === 'skip' && current.state !== null) {
    current.state.chain.skipped = { ABC: ['ABC-12'] }
    current.state.taskSessions['ABC-9'] = [
      {
        sessionId: session('ABC-9', 0).sessionId,
        at: ago(300),
        how: 'launch',
        resumed: 0,
        answers: 0,
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
  if ((params.get('chain') === 'ask' || params.get('chain') === 'unsaved') && current.state !== null && active) {
    const waiting = session('ABC-5', contextTokens, 'waiting')
    const asking: SessionView = params.get('chain') === 'ask' ? waiting : { ...waiting, waitingFor: 'input needed', ask: FAKE_UNSAVED_ASK }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? asking : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: asking.sessionId, since: ago(42) } }]
  }
  if (params.get('chain') === 'dialog' && current.state !== null && active) {
    const wedged: SessionView = {
      ...session('ABC-5', 0, 'waiting'),
      waitingFor: null,
      startupDialog: 'approve 1 new project MCP server (example) — attach to respond',
      lastActivityAt: null,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      stage: null,
      action: null,
      feed: [],
      cache: null,
      remoteUrl: null,
      remoteOff: 'no-bridge',
    }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? wedged : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: wedged.sessionId, since: ago(6) } }]
  }
  if (params.get('chain') === 'fix' && current.state !== null) current.state = withFix(current.state, 'ABC', session(fixName('ABC'), 38_000), ago(6))
  if (params.get('chain') === 'aside' && current.state !== null) {
    const asking = session('ABC-5', contextTokens, 'waiting')
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? asking : each))
    current.state = withFix(current.state, 'ABC', session(fixName('ABC'), 38_000), ago(6), true)
  }
  const cache = params.get('cache')
  if ((cache === 'warn' || cache === 'cold') && current.state !== null) {
    const until = ago(cache === 'warn' ? -8 : 20)
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? { ...each, cache: { ttl: '1h', until } } : each))
  }
  if (params.get('chain') === 'checkpoint' && current.state !== null && active?.current) {
    const { task, sessionId } = active.current
    current.state.taskSessions[task] = [
      { sessionId: sessionId ?? crypto.randomUUID(), at: ago(20), how: 'checkpoint', resumed: 0, answers: 0 },
      { sessionId: crypto.randomUUID(), at: ago(70), how: 'checkpoint', resumed: 0, answers: 0, replaced: { at: ago(20), how: 'checkpoint' } },
      { sessionId: crypto.randomUUID(), at: ago(150), how: 'launch', resumed: 0, answers: 0, replaced: { at: ago(70), how: 'checkpoint' } },
    ]
  }
  const notify = () => {
    for (const listener of listeners) listener()
  }

  const handover = params.get('chain') === 'handover'
  const closing = params.get('chain') === 'close' || handover
  let ticks = 0

  const close = (state: EvenKeelState): EvenKeelState => {
    if (!handover) return closeCurrent(state)
    const project = state.chain.active[0]?.project
    if (project === undefined) return state
    setTimeout(() => {
      current = { ...current, state: takeNext(current.state!, project) }
      notify()
    }, HANDOVER_MS)
    return finishCurrent(state)
  }

  if (params.get('config') === 'edited' && current.state !== null) {
    setTimeout(() => {
      current = { ...current, state: { ...current.state!, config: fakeHandEdit(current.state!.config) } }
      notify()
    }, HAND_EDIT_MS)
  }

  if (link === 'live') {
    setInterval(() => {
      const state = closing && ++ticks % CLOSE_TICKS === 0 ? close(current.state!) : current.state!
      const [kind, text] = FEED_STEPS[(closing ? ticks : ++ticks) % FEED_STEPS.length]!
      const line: FeedLine = { at: ago(0), kind, text }
      const sessions = state.sessions.map((view) =>
        view.lamp === 'working' && view.contextTokens > 0
          ? { ...view, contextTokens: view.contextTokens + 800, lastActivityAt: ago(0), action: line, feed: [...view.feed.slice(1), line] }
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
      if ((name === 'account/renew' || name === 'account/add') && deviceLogin(next.account)) {
        // The code goes on OpenAI's page, never through Even Keel: the sign-in ends by itself a while later.
        setTimeout(() => {
          const now = current.state
          if (now === null || now.account.login?.startedAt !== next.account.login?.startedAt) return
          current = { ...current, state: { ...now, account: accountCommand(now.account, 'account/code', { code: 'ok' }) } }
          notify()
        }, DEVICE_MS)
      }
    },
    session: async (sessionId) => {
      await answer()
      return current.state === null ? null : fakeRecord(current.state, sessionId)
    },
    transcript: async (sessionId, after) => {
      await new Promise((resolve) => setTimeout(resolve, ANSWER_MS))
      if (sessionId.endsWith('999')) return null
      const view = current.state?.sessions.find((each) => each.sessionId === sessionId)
      const turn = view?.lamp === 'working' ? { startedAt: turnStartedAt, tool: view.task === 'ABC-5' ? 'Bash npx vitest run src/chain' : null } : null
      if (after === 0) return { lines: fakeTranscript(view?.ask ?? null), turn }
      return { lines: [{ at: ago(0), kind: 'tool', text: `Read src/example-${Date.now() % 1000}.ts` }], turn }
    },
    onTranscript: () => () => {},
    imageUrl: (_sessionId, tool, index) => fakeImageUrl(tool, index),
    sentFileUrl: (_sessionId, name) => fakeSentFileUrl(name),
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
    statsCheckpoints: async () => {
      await answer()
      return fakeCheckpoints(params.get('stats'))
    },
    statsSpend: async () => {
      await answer()
      return fakeSpend(params.get('stats'))
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
