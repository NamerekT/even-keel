import type { LaunchEntry } from '../../../src/chain/dispatcher.js'
import { launchDays } from '../../../src/chain/launches.js'
import type { HulyHealth, HulyLinkState } from '../../../src/huly/health.js'
import type { HulyTask, StatusCategory } from '../../../src/huly/model.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { BatonState, SessionView } from '../../../src/state.js'
import type { Link, LiveSnapshot, LiveSource } from './connection.js'

const TICK_MS = 2_000
const LAUNCH_DAYS = 14

function task(id: string, title: string, name: string, category: StatusCategory, blockedBy: string[] = []): HulyTask {
  return { id, title, status: { name, category }, blockedBy }
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

function fakeState(huly: HulyLinkState, idle: boolean, contextTokens: number, launches: LaunchEntry[]): BatonState {
  const tasks = [
    task('ABC-1', 'Каркас сервера', 'Done', 'Won'),
    task('ABC-2', 'Чтение задач из трекера', 'Done', 'Won', ['ABC-1']),
    task('ABC-3', 'Опрос трекера по расписанию', 'Canceled', 'Lost', ['ABC-2']),
    task('ABC-4', 'Запуск сессий в фоне', 'Done', 'Won', ['ABC-2']),
    task('ABC-5', 'Цепочка задач по связям', 'In Progress', 'Active', ['ABC-4']),
    task('ABC-6', 'Страница проекта', 'In Progress', 'Active', ['ABC-5']),
    task('ABC-7', 'Разбор транскриптов сессий', 'In Progress', 'Active', ['ABC-6']),
    task('ABC-8', 'Лимиты подписки в шапке', 'In Progress', 'Active', ['ABC-7']),
    task('ABC-9', 'Журнал запусков', 'In Progress', 'Active', ['ABC-8']),
    task('ABC-10', 'Очередь цепочек', 'Todo', 'ToDo', ['ABC-9']),
    task('ABC-11', 'Панель сессии', 'Backlog', 'UnStarted', ['ABC-10']),
    task('ABC-12', 'Служба Windows с перезапуском при падении', 'Backlog', 'UnStarted', ['ABC-11']),
    task('ABC-13', 'Уведомления на телефон', 'Backlog', 'UnStarted', ['ABC-12']),
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
            current: { task: 'ABC-5', sessionId: null, since: ago(42) },
            paused: false,
            error: null,
          },
      queue: idle ? [] : ['DEMO'],
      projects: {
        ABC: { order: ['ABC-5', 'ABC-6', 'ABC-7', 'ABC-8', 'ABC-9', 'ABC-10', 'ABC-11', 'ABC-12', 'ABC-13'], error: null },
        DEMO: { order: ['DEMO-7', 'DEMO-8'], error: null },
        XYZ: { order: [], error: null },
        OPS: { order: ['OPS-2', 'OPS-3'], error: null },
      },
    },
    tasks,
    sessions: idle
      ? []
      : [
          session('ABC-4', 212_000, 'finished'),
          session('ABC-5', contextTokens),
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
    },
    huly: fakeHuly(huly),
    trackerUrl: 'https://huly.example.com/workbench/example/tracker/',
    launches: launchDays(launches, new Date(), LAUNCH_DAYS),
    context: { window: 600_000, warn: 50, danger: 80 },
  }
}

function setPaused(state: BatonState, paused: boolean): BatonState {
  const active = state.chain.active
  if (active === null) return state
  return { ...state, chain: { ...state.chain, active: { ...active, paused, error: paused ? active.error : null } } }
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
    state: link === 'connecting' ? null : fakeState(huly, idle, contextTokens, launches),
    link,
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
      if (name === 'start') current = { ...current, state: startChain(state, String(body.project), launches) }
      else if (name === 'pause' || name === 'resume') current = { ...current, state: setPaused(state, name === 'pause') }
      else throw new Error(`fake: ${name} is not supported`)
      notify()
    },
  }
}
