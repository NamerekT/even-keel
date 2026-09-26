import type { LaunchEntry } from '../../../src/chain/dispatcher.js'
import { launchDays } from '../../../src/chain/launches.js'
import type { HulyHealth, HulyLinkState } from '../../../src/huly/health.js'
import type { HulyTask, StatusCategory } from '../../../src/huly/model.js'
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
    feed: [
      { at: ago(3), kind: 'text', text: 'Читаю описание задачи и вложения.' },
      { at: ago(2), kind: 'tool', text: 'Read src/example.ts' },
      { at: ago(0), kind: 'tool', text: 'Edit src/example.ts' },
    ],
    remoteUrl: null,
  }
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

function fakeState(huly: HulyLinkState, idle: boolean, launches: LaunchEntry[]): BatonState {
  const tasks = [
    task('ABC-1', 'Каркас сервера', 'Done', 'Won'),
    task('ABC-2', 'Чтение задач из трекера', 'Done', 'Won', ['ABC-1']),
    task('ABC-3', 'Запуск сессий в фоне', 'In Progress', 'Active', ['ABC-2']),
    task('ABC-4', 'Цепочка задач по связям', 'Todo', 'ToDo', ['ABC-3']),
    task('ABC-5', 'Страница проекта', 'Backlog', 'UnStarted', ['ABC-4']),
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
            current: { task: 'ABC-3', sessionId: null, since: ago(42) },
            paused: false,
            error: null,
          },
      queue: idle ? [] : ['DEMO'],
      projects: {
        ABC: { order: ['ABC-3', 'ABC-4', 'ABC-5'], error: null },
        DEMO: { order: ['DEMO-7', 'DEMO-8'], error: null },
        XYZ: { order: [], error: null },
        OPS: { order: ['OPS-2', 'OPS-3'], error: null },
      },
    },
    tasks,
    sessions: idle ? [] : [session('ABC-3', 61_000), session('DEMO-7', 142_000, 'waiting')],
    limits: {
      fiveHour: { usedPercentage: 37, resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() },
      sevenDay: { usedPercentage: 64, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
      updatedAt: ago(0),
    },
    huly: fakeHuly(huly),
    launches: launchDays(launches, new Date(), LAUNCH_DAYS),
  }
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
  let current: LiveSnapshot = { state: link === 'connecting' ? null : fakeState(huly, idle, launches), link }
  const notify = () => {
    for (const listener of listeners) listener()
  }

  if (link === 'live') {
    setInterval(() => {
      const state = current.state!
      const sessions = state.sessions.map((view) =>
        view.lamp === 'working' ? { ...view, contextTokens: view.contextTokens + 800, lastActivityAt: ago(0) } : view,
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
      if (name !== 'start' || current.state === null) throw new Error(`fake: ${name} is not supported`)
      current = { ...current, state: startChain(current.state, String(body.project), launches) }
      notify()
    },
  }
}
