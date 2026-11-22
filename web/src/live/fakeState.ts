import type { LaunchEntry } from '../../../src/chain/dispatcher.js'
import { launchDays } from '../../../src/chain/launches.js'
import type { TrackerLinkState } from '../../../src/tracker/health.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import type { ActiveChainView, EvenKeelState, SessionView } from '../../../src/state.js'
import { fakeAccount, fakeUsage, FAKE_LIMITS } from './fakeAccounts.js'
import { FAKE_FIX, fakeCi, fakeMainCi } from './fakeCi.js'
import { fakeEventLog } from './fakeEvents.js'
import { fakeUpdates } from './fakeUpdates.js'
import { fakeBackup } from './fakeBackup.js'
import { FAKE_PROJECTS, FAKE_PULL_READINESS, FAKE_REMOTES, fakeConfig, fakeProjectMaps } from './fakeConfig.js'
import { fakePackages } from './fakePackages.js'
import { fakeSecrets } from './fakeSecrets.js'
import { fakeWrittenChangelogs } from './fakeChangelog.js'
import { fakeProfiles } from './fakeProfiles.js'
import { fakeFeedTrackers, fakeHuly } from './fakeTrackers.js'
import { ago, minutes, session, task } from './fakeSessions.js'
import { LAUNCH_DAYS } from './fakeCommands.js'

const REWORK = { labels: ['Переделка'] }
export const KEY_LIMIT_AGENTS: Record<string, string> = { spend: 'claude', spendUnknown: 'claude', credit: 'claude', codexCredit: 'codex', opencodeCredit: 'opencode', copilotMonthly: 'copilot' }

const LAUNCH_PATTERN: Record<string, number[]> = {
  ABC: [2, 1, 0, 3, 2, 0, 0, 1, 4, 2, 1, 0, 2, 1],
  DEMO: [0, 1, 2, 0, 0, 0, 1, 0, 0, 1, 2, 1, 0, 1],
  XYZ: [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0],
}

/** `?launches=favorite` makes ABC hold most of the launches, so the home page may joke about a favourite (BTN-1463). */
export function fakeLaunches(favorite: boolean): LaunchEntry[] {
  return Object.entries(LAUNCH_PATTERN).flatMap(([project, counts]) =>
    counts.flatMap((base, index) => {
      const count = favorite && project === 'ABC' ? base * 20 : base
      const at = new Date()
      at.setDate(at.getDate() - (counts.length - 1 - index))
      at.setHours(10, 0, 0, 0)
      return Array.from({ length: count }, () => ({ at: at.toISOString(), project, task: `${project}-1`, sessionId: 'fake' }))
    }),
  )
}

export function fakeState(
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
    task('ABC-10', 'Очередь цепочек', 'Todo', 'ToDo', [], 'v0.2 — удобство', { estimate: 1.5, parent: 'ABC-17' }),
    task('ABC-11', 'Панель сессии', 'Todo', 'ToDo', ['ABC-8', 'ABC-10'], 'v0.2 — удобство', { estimate: minutes(5), parent: 'ABC-17' }),
    { ...task('ABC-12', 'Вопрос: служба Windows или планировщик задач', 'Todo', 'ToDo', [], null, { priority: 'low' }), question: true },
    { ...task('ABC-13', 'Уведомления на телефон', 'Todo', 'ToDo', ['ABC-6'], 'v0.2 — удобство', { estimate: 3 }), question: true },
    task('ABC-14', 'Установка службы одним скриптом', 'Todo', 'ToDo', ['ABC-11'], 'v0.3 — служба', { priority: 'high', estimate: minutes(40) }),
    task('ABC-15', 'Перезапуск службы после обновления', 'Todo', 'ToDo', ['ABC-14'], 'v0.3 — служба', { priority: 'low', labels: ['Переделка', 'Bug'] }),
    task('ABC-18', 'Тёмная тема для печати', 'Backlog', 'UnStarted', [], 'v0.2 — удобство', { parent: 'ABC-17' }),
    task('ABC-19', 'Импорт задач из CSV', 'Backlog', 'UnStarted', [], 'v0.3 — служба'),
    task('ABC-20', 'Подсказки по горячим клавишам', 'Backlog', 'UnStarted'),
    task('DEMO-6', 'Старый формат отчёта', 'Canceled', 'Lost'),
    { ...task('DEMO-7', 'Вопрос: какие настройки переносить при импорте старого конфига, а какие спрашивать у пользователя заново', 'Todo', 'ToDo'), question: true },
    task('DEMO-8', 'Экспорт отчёта в CSV', 'Todo', 'ToDo', ['DEMO-7']),
    task('DEMO-9', 'Фильтр отчёта по датам', 'In Review', 'Active'),
    task('OPS-1', 'Резервное копирование', 'Done', 'Won'),
    task('OPS-2', 'Ротация логов службы', 'Todo', 'ToDo'),
    task('OPS-3', 'Проверка свободного места на диске перед запуском', 'Todo', 'ToDo', ['OPS-2']),
  ]
  return {
    startedAt: ago(180),
    demo: null,
    platform: 'win32',
    projects: FAKE_PROJECTS,
    ...fakeProjectMaps(),
    config: fakeConfig(account),
    runs: {
      ABC: {
        // The chain's rows carry runs too, for the run label in the key's line on a phone (BTN-1162).
        'ABC-5': { provider: 'claude', model: 'fable', effort: null },
        'ABC-6': { provider: 'opencode', model: 'openrouter/minimax/minimax-m2-with-a-long-model-name', effort: null },
        'ABC-7': { provider: 'codex', model: 'gpt-6.1-sol', effort: 'high' },
        'ABC-10': { provider: 'claude', model: 'sonnet', effort: 'high' },
        'ABC-11': { provider: 'opencode', model: 'opencode/deepseek-v4.1-flash-free', effort: null },
        'ABC-14': { provider: null, model: null, effort: 'low' },
        'ABC-15': { provider: 'opencode', model: 'router/vendor/deepseek-v4.1-flash-free-with-an-extra-long-model-suffix', effort: null },
        'ABC-19': { provider: 'codex', model: 'gpt-6.1-sol', effort: 'high' },
      },
    },
    branchDrift: {},
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
          // An old transcript that names no effort: the Model fact shows the model alone.
          { ...session('ABC-9', 350_000, 'finished'), contextWindow: null, effort: null },
          { ...session('DEMO-7', 142_000, 'waiting'), agent: 'codex', model: 'gpt-6.1-sol', effort: 'medium', contextWindow: 258_400, remoteUrl: null, remoteOff: null },
          session('ABC-16', 118_000, 'finished'),
        ],
    // The tasks of the "Parents" view (BTN-1041): two open families of the chain's rows and one closed parent.
    parents: {
      ABC: [
        { ...task('ABC-16', 'Ядро цепочки', 'In Progress', 'Active', [], 'v0.1 — каркас', { subtasks: 4 }), closedSubtasks: 1 },
        { ...task('ABC-17', 'Удобство страницы', 'Todo', 'ToDo', [], 'v0.2 — удобство', { subtasks: 3 }), closedSubtasks: 0 },
        { ...task('ABC-21', 'Первый запуск', 'Done', 'Won', [], 'v0.1 — каркас', { subtasks: 2 }), closedSubtasks: 2 },
      ],
    },
    limits: FAKE_LIMITS,
    usage: fakeUsage(usage),
    account: (() => {
      const view = fakeAccount(limit?.startsWith('spend') ? limit : limit !== null && KEY_LIMIT_AGENTS[limit] ? 'api' : account, idle, FAKE_LIMITS)
      if (usage === null) return view
      return { ...view, accounts: view.accounts.map((entry) => ({ ...entry, usage: fakeUsage(usage) })) }
    })(),
    trackers: [fakeHuly(huly), ...fakeFeedTrackers()],
    trackerUrls: {
      default: 'https://huly.example.com/workbench/example/tracker/{id}',
      projects: {},
      pages: {
        ...Object.fromEntries(['ABC', 'DEMO', 'XYZ', 'OPS'].map((project) => [project, `https://huly.example.com/workbench/example/tracker/${project.toLowerCase()}-id/issues`])),
        'feed-abc-gh': 'https://github.com/octo-org/storefront-ideas/issues',
        'feed-abc-lin': 'https://linear.app/example/team/WEB/all',
      },
    },
    ci: fakeCi(null),
    mainCi: fakeMainCi(null).mainCi,
    remotes: FAKE_REMOTES,
    sameRepository: {},
    pullReadiness: FAKE_PULL_READINESS,
    launches: launchDays(launches, new Date(), LAUNCH_DAYS),
    taskSessions: idle
      ? {}
      : {
          'ABC-5': [
            { sessionId: session('ABC-5', 0).sessionId, at: ago(42), how: 'relay', resumed: 0, answers: 0, account: 'john.doe@example.com' },
            { sessionId: '00000000-0000-4000-8000-000000000105', at: ago(400), how: 'launch', resumed: 1, answers: 2, compactions: 1, account: 'jane.roe@example.com' },
          ],
          'ABC-4': [
            { sessionId: session('ABC-4', 0).sessionId, at: ago(900), how: 'checkpoint', resumed: 0, answers: 0, account: 'john.doe@example.com' },
            // An ended Codex session on the e-mail the Claude account has too: the list names it OpenAI (BTN-1341).
            { sessionId: '00000000-0000-4000-8000-000000000104', at: ago(960), how: 'launch', resumed: 0, answers: 0, account: 'john.doe@example.com', agent: 'codex' },
          ],
          'ABC-6': [{ sessionId: session('ABC-6', 0).sessionId, at: ago(60), how: 'manual', resumed: 0, answers: 0, account: 'jane.roe@example.com' }],
          'ABC-16': [{ sessionId: session('ABC-16', 0).sessionId, at: ago(1_200), how: 'launch', resumed: 0, answers: 0, account: 'john.doe@example.com' }],
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
    works: idle
      ? {}
      : {
          ABC: {
            'ABC-9': { path: 'D:/work/abc/.claude/worktrees/abc-9', branch: 'abc-9/task', files: 0, ahead: 3 },
            'ABC-19': { path: 'D:/work/abc/.claude/worktrees/abc-19', branch: 'abc-19/task', files: 49, ahead: 0 },
          },
        },
    // The chat's foot counts ABC-5's branch, more than its session's own edits (BTN-1424).
    diffs: idle
      ? {}
      : { ABC: { 'ABC-5': { added: 720, removed: 89 }, 'ABC-9': { added: 214, removed: 37 }, 'ABC-19': { added: 1_380, removed: 410 } } },
    context: { warn: 50, danger: 80 },
    configError: null,
    packages: fakePackages(['ABC', 'DEMO', 'XYZ', 'OPS'], null),
    secrets: fakeSecrets(null),
    profiles: fakeProfiles(null),
    language: null,
    unattended: false,
    trimTools: true,
    showTests: { home: false, stats: false },
    tally: 'local',
    tallyHealth: { state: 'ok', lastRunAt: ago(3) },
    updates: fakeUpdates(null),
    backup: fakeBackup(null),
    cliVersions: [],
    cliChecks: [],
    git: { version: '2.47.1', name: 'John Doe', email: 'john@example.com' },
    fallbacks: [],
    mailbox: {},
    changelogs: fakeWrittenChangelogs(),
    forwards: {},
    eventLog: fakeEventLog(FAKE_PROJECTS),
  }
}

function fakeLimit(kind: string | null): { limit: LimitHold } | Record<string, never> {
  if (kind === null || (!KEY_LIMIT_AGENTS[kind] && kind !== 'relay' && kind !== 'resume' && kind !== 'unknown' && kind !== 'codex' && kind !== 'codexLong')) return {}
  const credit = !!KEY_LIMIT_AGENTS[kind] && kind !== 'copilotMonthly'
  const resetsAt = kind === 'spend' ? '2026-11-01T00:00:00.000Z' : kind === 'unknown' || credit ? null : new Date(Date.now() + 95 * 60_000).toISOString()
  const account = KEY_LIMIT_AGENTS[kind] ? 'ci-key' : kind.startsWith('codex') ? 'codex' : 'john@example.com'
  return {
    limit: { at: ago(3), account, resetsAt, lastReplyAt: ago(4), then: kind === 'resume' ? 'resume' : 'relay', acted: null },
  }
}

/** A held task with a known reset has its account spent, as the service tells the page (BTN-1359): "New session" waits for it. */
export function withFakeSpent(state: EvenKeelState, lane: ActiveChainView): ActiveChainView {
  const resetsAt = lane.current?.limit?.resetsAt
  const view = state.sessions.find((each) => each.task === lane.current?.task)
  if (resetsAt == null || view === undefined || view.apiErrorKind === 'transient') return lane
  const entry = state.account.accounts.find((each) => each.key === view.account)
  const account = entry?.name ?? entry?.status?.email ?? view.account ?? undefined
  return { ...lane, spent: { until: resetsAt, ...(account !== undefined && { account }), provider: view.agent } }
}

function limitedSession(view: SessionView, kind: string): SessionView {
  if (kind === 'codex' || kind === 'codexLong') return {
    ...view, agent: 'codex', account: 'codex', model: 'gpt-6.1-sol', remoteUrl: null, remoteOff: null,
    apiErrorKind: 'limit', apiError: 'You have hit your usage limit. Try again after the reset.', lastActivityAt: ago(3),
  }
  const agent = KEY_LIMIT_AGENTS[kind]
  if (agent) {
    const credit = kind !== 'copilotMonthly'
    return {
      ...view, agent, model: null, apiErrorKind: credit ? 'credit' : 'limit',
      apiError: credit ? 'Credit balance is too low' : 'Monthly premium request allowance used up',
      ...(kind.startsWith('spend') && {
        apiErrorKind: 'spend' as const,
        apiError: `You have reached your specified API usage limits.${kind === 'spend' ? ' You will regain access on 2026-11-01 at 00:00 UTC.' : ''}`,
      }),
      lastActivityAt: ago(3), remoteUrl: null, remoteOff: agent === 'claude' ? 'api-key' : null, account: 'ci-key',
    }
  }
  return { ...view, apiErrorKind: 'limit', apiError: "You've hit your session limit · resets 7:20pm (Europe/Berlin)", lastActivityAt: ago(3) }
}
