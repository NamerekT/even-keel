import { notice, textNotice } from '../../../src/notice/notice.js'
import type { LaunchEntry } from '../../../src/chain/dispatcher.js'
import { fixName } from '../../../src/chain/fix.js'
import { launchDays } from '../../../src/chain/launches.js'
import type { TrackerLinkState, TrackerView } from '../../../src/tracker/health.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import { isLanguage } from '../../../src/language.js'
import { isTallyMode, TALLY_DISABLED, TALLY_UNCHOSEN } from '../../../src/stats/mode.js'
import type { EvenKeelState, SessionRecord, SessionView } from '../../../src/state.js'
import type { Link, LiveSnapshot, LiveSource } from './connection.js'
import { deviceLogin } from '../accounts.js'
import { accountCommand, fakeAccount, fakeUsage, FAKE_LIMITS } from './fakeAccounts.js'
import { FAKE_FIX, fakeCi } from './fakeCi.js'
import { fakeUpdates } from './fakeUpdates.js'
import { FAKE_PROJECT_IDS, FAKE_REMOTES, FAKE_VOCABULARY, fakeConfig, fakeHandEdit } from './fakeConfig.js'
import { withFix } from './fakeFix.js'
import { fakeCompare, fakeRuleDiff, fakeRules } from './fakeRules.js'
import { fakeSteps } from './fakeSteps.js'
import { fakeCheckpoints, fakeHistory, fakePeriod, fakeSpend, fakeTask } from './fakeStats.js'
import { fakeCard } from './fakeCards.js'
import { fakeCalls, fakeDeliverMail, fakeImageUrl, fakeMailbox, fakeOpenAsk, fakePastAsk, fakeSentFileUrl, fakeShots, FAKE_UNSAVED_ASK } from './fakeChat.js'
import type { Ask } from '../../../src/sessions/ask.js'
import { fakeTools } from './fakeTools.js'
import { fakePackages } from './fakePackages.js'
import { fakeSecrets } from './fakeSecrets.js'
import { fakeChangelog, fakeWrittenChangelogs } from './fakeChangelog.js'
import { FAKE_HULY_PROFILE, fakeProfiles, fakeProfilesQuery, fakeSaved } from './fakeProfiles.js'
import { fakeCheck, fakeNoProjects } from './fakeProjects.js'
import { ago, fakeFeed, FEED_STEPS, minutes, session, task, turnStartedAt } from './fakeSessions.js'
import { closeCurrent, fakeCommand, finishCurrent, LAUNCH_DAYS, setPaused, startChain, startStages, takeNext } from './fakeCommands.js'

const TICK_MS = 2_000
const ANSWER_MS = 300
const CLOSE_TICKS = 5
const HANDOVER_MS = 1_000
const DEVICE_MS = 8_000
const START_STAGE_MS = 3_000
/** How long a message waits in the fake mailbox before the hook takes it. */
const MAIL_MS = 4_000
/** `?config=edited`: time to open the settings and start a draft before the file changes under it. */
const HAND_EDIT_MS = 15_000

const REWORK = { labels: ['Переделка'] }

function fakeTranscript(open: Ask | null): FeedLine[] {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
  return [
    { at: at(40), kind: 'prompt', text: 'ABC-5\n\nWorking folder: C:\\repos\\example-project\\.claude\\worktrees\\abc-5' },
    { at: at(39), kind: 'text', text: 'Читаю описание задачи и вложения.' },
    { at: at(38), kind: 'tool', text: 'Bash Run the chain tests', detail: 'npx vitest run src/chain\nnpx tsc --noEmit', name: 'Bash', subject: 'Run the chain tests' },
    ...fakePastAsk(at),
    {
      at: at(30),
      kind: 'text',
      text: 'Порядок строится топологической сортировкой.\n\n- цикл сейчас роняет сервер;\n- сначала тест на цикл, потом правка.\n\n' + 'Длинное объяснение. '.repeat(40),
    },
    ...fakeShots(at),
    { at: at(20), kind: 'prompt', text: 'А почему цикл не ловится раньше?' },
    ...fakeCalls(at),
    ...fakeFeed(),
    ...fakeOpenAsk(open),
  ]
}

function fakeHuly(state: TrackerLinkState): TrackerView {
  const projects = ['ABC', 'DEMO', 'XYZ', 'OPS']
  const view = { name: FAKE_HULY_PROFILE, kind: 'huly', title: 'Huly · example', projects, ready: true }
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
    task('DEMO-9', 'Фильтр отчёта по датам', 'In Review', 'Active'),
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
        DEMO: {
          order: ['DEMO-7', 'DEMO-8'],
          waiting: [],
          backlog: [],
          reviews: [{ task: 'DEMO-9', number: 12, url: 'https://example.com/demo/pulls/12', feedback: true }],
          error: null,
        },
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
          { ...session('ABC-9', 350_000, 'finished'), contextWindow: null },
          { ...session('DEMO-7', 142_000, 'waiting'), agent: 'codex', model: 'gpt-6.1-sol', contextWindow: 258_400, remoteUrl: null, remoteOff: null },
        ],
    limits: FAKE_LIMITS,
    usage: fakeUsage(usage),
    account: fakeAccount(account, idle, FAKE_LIMITS),
    trackers: [fakeHuly(huly)],
    trackerUrls: {
      default: 'https://huly.example.com/workbench/example/tracker/{id}',
      projects: {},
      pages: Object.fromEntries(['ABC', 'DEMO', 'XYZ', 'OPS'].map((project) => [project, `https://huly.example.com/workbench/example/tracker/${project.toLowerCase()}-id/issues`])),
    },
    ci: fakeCi(null),
    remotes: FAKE_REMOTES,
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
    secrets: fakeSecrets(null),
    profiles: fakeProfiles(null),
    language: null,
    unattended: false,
    trimTools: true,
    tally: 'local',
    updates: fakeUpdates(null),
    cliVersions: [],
    fallbacks: [],
    mailbox: {},
    changelogs: fakeWrittenChangelogs(),
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
    contextWindow: live?.contextWindow ?? null,
    tokens: live?.tokens ?? { input: 192, output: 78_000, cacheRead: 17_400_000, cacheWrite: 243_000 },
    stage: 'test',
    feed: [...fakeFeed(), ...fakeFeed()],
    workdir: 'C:\\repos\\example-project\\.claude\\worktrees\\abc-5',
    branch: 'abc-5/chain-order',
    apiError: live?.apiError ?? "You've hit your session limit · resets 7:20pm (Europe/Berlin)",
    account: live?.account ?? state.taskSessions['ABC-5']?.find((row) => row.sessionId === sessionId)?.account ?? 'jane.roe@example.com',
  }
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
  // Stats turned off or never chosen answer as the service does, whatever `stats=` asks for.
  const statsMode = () => (current.state?.tally === 'off' ? TALLY_DISABLED : current.state?.tally === null ? TALLY_UNCHOSEN : params.get('stats'))
  let current: LiveSnapshot = {
    state: link === 'connecting' ? null : fakeState(huly, idle, contextTokens, launches, params.get('account'), params.get('limit'), params.get('usage')),
    link,
  }
  const language = params.get('lang')
  if (isLanguage(language) && current.state !== null) current.state.language = language
  if (params.has('ci') && current.state !== null) current.state.ci = fakeCi(params.get('ci'))
  if (params.has('update') && current.state !== null) current.state.updates = fakeUpdates(params.get('update'))
  if (params.get('cli') === 'unchecked' && current.state !== null) {
    const unchecked = (agent: string, title: string, installed: string, checked: string) => ({
      agent,
      account: null,
      installed,
      checked,
      notice: { code: 'agent.uncheckedVersion' as const, params: { title, installed, checked } },
    })
    current.state.cliVersions = [unchecked('claude', 'Claude Code', '2.1.303', '2.1.301'), unchecked('codex', 'Codex', '0.163.0', '0.162.1')]
  }
  if (params.get('cli') === 'daemon' && current.state !== null) {
    const params = { title: 'Claude Code', account: 'global', running: '2.1.303', wanted: '2.1.301' }
    current.state.cliVersions = [{ agent: 'claude', account: 'global', installed: '2.1.303', checked: '2.1.301', notice: { code: 'agent.daemonVersion', params } }]
  }
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
  if (params.get('projects') === 'none' && current.state !== null) current.state = fakeNoProjects(current.state)
  if (params.has('tally') && current.state !== null) {
    const mode = params.get('tally')
    current.state.tally = isTallyMode(mode) ? mode : null
  }
  if (params.has('packages') && current.state !== null) current.state.packages = fakePackages(current.state.projects, params.get('packages'))
  if (params.has('secrets') && current.state !== null) current.state.secrets = fakeSecrets(params.get('secrets'))
  if (params.has('profiles') && current.state !== null) current.state.profiles = fakeProfiles(params.get('profiles'))
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
    current.state.chain.skipped = { ABC: ['ABC-12'], OPS: ['OPS-2', 'OPS-3'] }
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
  if (params.get('chain') === 'mail' && current.state !== null && active) {
    const working = session('ABC-5', contextTokens)
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? working : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: working.sessionId, since: ago(42) } }]
    current.state.mailbox = { [working.sessionId]: fakeMailbox('ABC-5', working.sessionId, Date.now()) }
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
      if (name === 'session/answer') {
        setTimeout(() => {
          if (current.state === null) return
          current = { ...current, state: fakeDeliverMail(current.state) }
          notify()
        }, MAIL_MS)
      }
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
    vocabulary: async (projectId) => {
      await answer()
      const mode = params.get('vocabulary')
      if (mode === 'fail') throw new Error('huly: not connected')
      return mode === 'none' || !Object.values(FAKE_PROJECT_IDS).includes(projectId) ? null : FAKE_VOCABULARY
    },
    checkProject: async (draft) => {
      await answer()
      if (current.state === null) throw new Error('fake: no state yet')
      return fakeCheck(current.state, draft, params.get('wizard'))
    },
    query: async <T>(name: string, body: Record<string, unknown>) => {
      await answer()
      if (current.state === null) throw new Error('fake: no state yet')
      const draft = await fakeChangelog(current.state, name, body, params.get('changelog'))
      if (draft !== null) return draft as T
      const result = fakeProfilesQuery(current.state, name, body)
      if (name === 'profiles/save') {
        current = { ...current, state: fakeSaved(current.state, (result as { id: string }).id, body) }
        notify()
      }
      return result as T
    },
    statsHistory: async (filter) => {
      await answer()
      return fakeHistory(statsMode(), filter)
    },
    statsPeriod: async (query) => {
      await answer()
      return fakePeriod(statsMode(), query)
    },
    statsSteps: async (query) => {
      await answer()
      return fakeSteps(statsMode(), query)
    },
    statsCheckpoints: async () => {
      await answer()
      return fakeCheckpoints(statsMode())
    },
    statsSpend: async () => {
      await answer()
      return fakeSpend(statsMode())
    },
    statsTask: async (task) => {
      await answer()
      return fakeTask(statsMode(), task)
    },
    statsRules: async (query) => {
      await answer()
      return fakeRules(statsMode(), params.get('rules'), query)
    },
    statsRuleDiff: async (changes) => {
      await answer()
      return fakeRuleDiff(statsMode(), changes)
    },
    statsCompare: async (query) => {
      await answer()
      return fakeCompare(statsMode(), params.get('rules'), query)
    },
  }
}
