import { loginBlockMessage, type AccountLogin, type AccountView, type ClaudeAccount } from '../../../src/account/model.js'
import type { LaunchEntry } from '../../../src/chain/dispatcher.js'
import { launchDays } from '../../../src/chain/launches.js'
import { checkOrder } from '../../../src/chain/order.js'
import type { HulyHealth, HulyLinkState } from '../../../src/huly/health.js'
import type { HulyTask, StatusCategory } from '../../../src/huly/model.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { UsageHealth } from '../../../src/limits/usage.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import type { BatonState, SessionRecord, SessionView } from '../../../src/state.js'
import type { Link, LiveSnapshot, LiveSource } from './connection.js'

const TICK_MS = 2_000
const LAUNCH_DAYS = 14

function task(
  id: string,
  title: string,
  name: string,
  category: StatusCategory,
  blockedBy: string[] = [],
  milestone: string | null = null,
): HulyTask {
  return { id, title, status: { name, category }, blockedBy, milestone: milestone === null ? null : { label: milestone, targetDate: 0 } }
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
    tokens: { input: 18_400, output: 9_200, cacheRead: 1_240_000, cacheWrite: 96_000 },
    stage: 'edit',
    action: { at: ago(0), kind: 'tool', text: 'Edit src/example.ts' },
    feed: fakeFeed(),
    remoteUrl: lamp === 'working' || lamp === 'waiting' ? 'https://claude.ai/code/session_example' : null,
    remoteOff: lamp === 'working' || lamp === 'waiting' ? null : 'no-bridge',
  }
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

function fakeFeed(): FeedLine[] {
  return Array.from({ length: 30 }, (_, index) => {
    const [kind, text] = FEED_STEPS[index % FEED_STEPS.length]!
    return { at: new Date(Date.now() - (30 - index) * 25_000).toISOString(), kind, text }
  })
}

function fakeHuly(state: HulyLinkState): HulyHealth {
  if (state === 'off' || state === 'connecting') return { state, lastOkAt: null, error: null }
  if (state === 'down') return { state, lastOkAt: ago(4), error: 'huly: call timed out after 15000 ms' }
  return { state, lastOkAt: ago(0), error: null }
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
  huly: HulyLinkState,
  idle: boolean,
  contextTokens: number,
  launches: LaunchEntry[],
  account: string | null,
  limit: string | null,
  usage: string | null,
): BatonState {
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
    task('ABC-11', 'Панель сессии', 'Backlog', 'UnStarted', ['ABC-8', 'ABC-10'], 'v0.2 — удобство'),
    task('ABC-12', 'Служба Windows с перезапуском при падении', 'Backlog', 'UnStarted'),
    task('ABC-13', 'Уведомления на телефон', 'Backlog', 'UnStarted', ['ABC-6'], 'v0.2 — удобство'),
    task('DEMO-6', 'Старый формат отчёта', 'Canceled', 'Lost'),
    task('DEMO-7', 'Импорт настроек', 'Todo', 'ToDo'),
    task('DEMO-8', 'Экспорт отчёта в CSV', 'Backlog', 'UnStarted', ['DEMO-7']),
    task('OPS-1', 'Резервное копирование', 'Done', 'Won'),
    task('OPS-2', 'Ротация логов службы', 'Todo', 'ToDo'),
    task('OPS-3', 'Проверка свободного места на диске перед запуском', 'Backlog', 'UnStarted', ['OPS-2']),
  ]
  return {
    startedAt: ago(180),
    projects: ['ABC', 'DEMO', 'XYZ', 'OPS'],
    chain: {
      active: idle
        ? null
        : {
            project: 'ABC',
            current: { task: 'ABC-5', sessionId: null, since: ago(42), ...fakeLimit(limit) },
            paused: false,
            error: null,
          },
      queue: idle ? [] : ['DEMO', 'OPS'],
      projects: {
        ABC: { order: ['ABC-5', 'ABC-6', 'ABC-7', 'ABC-8', 'ABC-9', 'ABC-10', 'ABC-11', 'ABC-12', 'ABC-13'], error: null },
        DEMO: { order: ['DEMO-7', 'DEMO-8'], error: null },
        XYZ: { order: [], error: null },
        OPS: { order: ['OPS-2', 'OPS-3'], error: null },
      },
      skipped: {},
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
    limits: {
      fiveHour: { usedPercentage: 37, resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() },
      sevenDay: { usedPercentage: 64, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
      updatedAt: ago(0),
      source: 'usage',
    },
    usage: fakeUsage(usage),
    account: fakeAccount(account, idle),
    huly: fakeHuly(huly),
    trackerUrl: 'https://huly.example.com/workbench/example/tracker/',
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

function fakeRecord(state: BatonState, sessionId: string): SessionRecord | null {
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

function setPaused(state: BatonState, paused: boolean): BatonState {
  const active = state.chain.active
  if (active === null) return state
  return { ...state, chain: { ...state.chain, active: { ...active, paused, error: paused ? active.error : null } } }
}

function stopChain(state: BatonState, launches: LaunchEntry[]): BatonState {
  const [next, ...rest] = state.chain.queue
  const stopped = { ...state, chain: { ...state.chain, active: null, queue: rest } }
  return next === undefined ? stopped : startChain(stopped, next, launches)
}

function startChain(state: BatonState, project: string, launches: LaunchEntry[]): BatonState {
  if (!state.projects.includes(project)) throw new Error(`chain: ${project} is not a configured project`)
  const { active, queue } = state.chain
  if (active?.project === project || queue.includes(project)) return state
  if (active !== null) return { ...state, chain: { ...state.chain, queue: [...queue, project] } }
  const first = state.chain.projects[project]?.order[0]
  if (first === undefined) return state
  const since = ago(0)
  launches.push({ at: since, project, task: first, sessionId: 'fake' })
  return {
    ...state,
    chain: { ...state.chain, active: { project, current: { task: first, sessionId: 'fake', since }, paused: false, error: null } },
    sessions: [...state.sessions, session(first, 0)],
    launches: launchDays(launches, new Date(), LAUNCH_DAYS),
  }
}

function requeue(state: BatonState, order: string[]): BatonState {
  const queue = state.chain.queue
  if (order.length !== queue.length || !order.every((key) => queue.includes(key))) {
    throw new Error(`chain: the queue has changed, it is now ${queue.join(', ') || 'empty'}`)
  }
  return { ...state, chain: { ...state.chain, queue: [...order] } }
}

function reorder(state: BatonState, project: string, order: string[]): BatonState {
  const tasks = state.tasks.filter((task) => task.id.startsWith(`${project}-`) && order.includes(task.id))
  checkOrder(tasks, order)
  const current = state.chain.active?.project === project ? state.chain.active.current?.task : undefined
  if (current !== undefined && order[0] !== current) throw new Error(`chain: ${current} is running and stays first`)
  return { ...state, chain: { ...state.chain, projects: { ...state.chain.projects, [project]: { order: [...order], error: null } } } }
}

function skip(state: BatonState, project: string, task: string): BatonState {
  const active = state.chain.active
  const holder = active?.project === project && active.current?.task === task ? active : null
  const view = state.sessions.find((each) => each.task === task && each.lamp !== 'finished')
  if (holder !== null && (view?.lamp === 'working' || view?.waitingFor != null)) {
    throw new Error(`chain: ${task} is mid-turn; wait until its session stops`)
  }
  const skipped = state.chain.skipped[project] ?? []
  return {
    ...state,
    chain: {
      ...state.chain,
      active: holder === null ? active : { ...holder, current: null },
      skipped: { ...state.chain.skipped, [project]: skipped.includes(task) ? skipped : [...skipped, task] },
    },
  }
}

function restart(state: BatonState, project: string, task: string): BatonState {
  const active = state.chain.active
  const current = active?.project === project && active.current?.task === task ? active.current : null
  if (active === null || current === null) throw new Error(`chain: ${task} is not the current task of a chain`)
  const view = state.sessions.find((each) => each.task === task)
  if (view === undefined) throw new Error(`chain: no session of ${task} is known`)
  if (view.lamp === 'working' || view.waitingFor !== null) throw new Error(`chain: ${task} is mid-turn; wait until its session stops`)
  const sessionId = crypto.randomUUID()
  const fresh: SessionView = { ...view, sessionId, lamp: 'working', apiError: null, startedAt: ago(0), remoteUrl: 'https://claude.ai/code/session_example', remoteOff: null }
  const rows = (state.taskSessions[task] ?? []).map((row) => (row.sessionId === view.sessionId ? { ...row, replaced: ago(0) } : row))
  return {
    ...state,
    chain: { ...state.chain, active: { ...active, current: { task, sessionId, since: current.since } } },
    sessions: state.sessions.map((each) => (each === view ? fresh : each)),
    taskSessions: { ...state.taskSessions, [task]: [{ sessionId, at: ago(0), how: 'restart', resumed: 0 }, ...rows] },
  }
}

function unskip(state: BatonState, project: string, task: string): BatonState {
  const { [project]: skipped = [], ...rest } = state.chain.skipped
  const kept = skipped.filter((id) => id !== task)
  return { ...state, chain: { ...state.chain, skipped: kept.length === 0 ? rest : { ...rest, [project]: kept } } }
}

function dequeue(state: BatonState, project: string): BatonState {
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
  startedAt: ago(1),
  urls: ['https://claude.example.com/oauth/authorize?code=true&state=example'],
  output: "Browser didn't open? Use the url below to sign in:\n\nhttps://claude.example.com/oauth/authorize?code=true&state=example",
  error: null,
  codeSent: false,
}

function fakeUsage(mode: string | null): UsageHealth {
  if (mode === 'unread') return { state: 'unread', reason: 'no readable "Current week (all models)" line', since: ago(12) }
  if (mode === 'off') return { state: 'off', reason: 'num_turns is 1, not 0', since: ago(3) }
  if (mode === 'waiting') return { state: 'waiting', reason: null, since: null }
  return { state: 'ok', reason: null, since: ago(60) }
}

function fakeAccount(mode: string | null, idle: boolean): AccountView {
  const signedIn: AccountView = {
    status: FAKE_ACCOUNT,
    error: null,
    login: null,
    loginBlock: idle
      ? null
      : {
          chain: 'ABC',
          sessions: [
            { name: 'ABC-5', status: 'busy', waitingFor: null },
            { name: 'Scratch notes', status: 'waiting', waitingFor: 'permission' },
          ],
        },
  }
  if (mode === 'out') {
    return { ...signedIn, status: { loggedIn: false, authMethod: 'none', email: null, orgName: null, subscriptionType: null } }
  }
  if (mode === 'login') return { ...signedIn, login: FAKE_LOGIN, loginBlock: null }
  if (mode === 'failed') {
    return { ...signedIn, login: { ...FAKE_LOGIN, error: 'claude: sign-in exited with code 1: OAuth error' }, loginBlock: null }
  }
  if (mode === 'unknown') return { ...signedIn, status: null, error: 'claude: auth status timed out' }
  return signedIn
}

function accountCommand(account: AccountView, name: string, body: Record<string, unknown>): AccountView {
  if (name === 'account/login') {
    if (account.loginBlock !== null) throw new Error(loginBlockMessage(account.loginBlock))
    return { ...account, login: { ...FAKE_LOGIN, startedAt: ago(0) } }
  }
  if (name === 'account/cancel') return { ...account, login: null }
  if (name === 'account/code') {
    if (account.login === null) throw new Error('claude: no sign-in is running')
    if (String(body.code).trim() === 'fail') {
      return { ...account, login: { ...account.login, error: 'claude: sign-in exited with code 1: Invalid code' } }
    }
    return { ...account, status: { ...FAKE_ACCOUNT, email: 'jane.roe@example.com' }, login: null }
  }
  throw new Error(`fake: ${name} is not supported`)
}

function fakeCommand(state: BatonState, name: string, body: Record<string, unknown>, launches: LaunchEntry[]): BatonState {
  if (name === 'chain/start') return startChain(state, String(body.project), launches)
  if (name === 'chain/pause' || name === 'chain/resume') return setPaused(state, name === 'chain/pause')
  if (name === 'chain/stop') return stopChain(state, launches)
  if (name === 'chain/queue') return requeue(state, body.order as string[])
  if (name === 'chain/dequeue') return dequeue(state, String(body.project))
  if (name === 'chain/order') return reorder(state, String(body.project), body.order as string[])
  if (name === 'chain/skip') return skip(state, String(body.project), String(body.task))
  if (name === 'chain/unskip') return unskip(state, String(body.project), String(body.task))
  if (name === 'chain/restart') return restart(state, String(body.project), String(body.task))
  if (name.startsWith('account/')) return { ...state, account: accountCommand(state.account, name, body) }
  throw new Error(`fake: ${name} is not supported`)
}

function isLink(value: string | null): value is Link {
  return value === 'connecting' || value === 'live' || value === 'stale'
}

function isHulyState(value: string | null): value is HulyLinkState {
  return value === 'off' || value === 'connecting' || value === 'live' || value === 'down'
}

export function createFakeSource(search: string): LiveSource {
  const params = new URLSearchParams(search)
  const requested = params.get('link')
  const link: Link = isLink(requested) ? requested : 'live'
  const requestedHuly = params.get('huly')
  const huly: HulyLinkState = isHulyState(requestedHuly) ? requestedHuly : 'live'
  const listeners = new Set<() => void>()
  const launches = fakeLaunches()
  const idle = params.get('chain') === 'idle'
  const contextTokens = Number(params.get('ctx') ?? 61_000)
  let current: LiveSnapshot = {
    state: link === 'connecting' ? null : fakeState(huly, idle, contextTokens, launches, params.get('account'), params.get('limit'), params.get('usage')),
    link,
  }
  const active = current.state?.chain.active
  if (params.get('chain') === 'limit' && active) {
    current.state!.chain.active = { ...active, current: null, limitUntil: new Date(Date.now() + 95 * 60_000).toISOString() }
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
  if (params.get('chain') === 'restart' && current.state !== null && active) {
    const stalled: SessionView = {
      ...session('ABC-5', contextTokens, 'limit'),
      apiError: 'Лимит исчерпан: Claude Code велел сессии свернуть ход',
      remoteUrl: null,
      remoteOff: 'lost',
    }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? stalled : each))
    current.state.chain.active = { ...active, current: { task: 'ABC-5', sessionId: stalled.sessionId, since: ago(42) } }
  }
  const notify = () => {
    for (const listener of listeners) listener()
  }

  if (link === 'live') {
    setInterval(() => {
      const state = current.state!
      const sessions = state.sessions.map((view) =>
        view.lamp === 'working'
          ? {
              ...view,
              contextTokens: view.contextTokens + 800,
              lastActivityAt: ago(0),
              feed: [...view.feed.slice(1), { at: ago(0), kind: 'tool' as const, text: `Read src/example-${Date.now() % 1000}.ts` }],
            }
          : view,
      )
      const hulyNow = state.huly.state === 'live' ? { ...state.huly, lastOkAt: ago(0) } : state.huly
      current = { ...current, state: { ...state, sessions, huly: hulyNow } }
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
      current = { ...current, state: fakeCommand(state, name, body, launches) }
      notify()
    },
    session: async (sessionId) => {
      await new Promise((resolve) => setTimeout(resolve, 300))
      return current.state === null ? null : fakeRecord(current.state, sessionId)
    },
  }
}
