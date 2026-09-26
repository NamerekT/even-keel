import type { HulyHealth, HulyLinkState } from '../../../src/huly/health.js'
import type { HulyTask, StatusCategory } from '../../../src/huly/model.js'
import type { BatonState, SessionView } from '../../../src/state.js'
import type { Link, LiveSnapshot, LiveSource } from './connection.js'

const TICK_MS = 2_000

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

function fakeState(huly: HulyLinkState): BatonState {
  const tasks = [
    task('ABC-1', 'Каркас сервера', 'Done', 'Won'),
    task('ABC-2', 'Чтение задач из трекера', 'Done', 'Won', ['ABC-1']),
    task('ABC-3', 'Запуск сессий в фоне', 'In Progress', 'Active', ['ABC-2']),
    task('ABC-4', 'Цепочка задач по связям', 'Todo', 'ToDo', ['ABC-3']),
    task('ABC-5', 'Страница проекта', 'Backlog', 'UnStarted', ['ABC-4']),
    task('DEMO-7', 'Импорт настроек', 'Todo', 'ToDo'),
    task('DEMO-8', 'Экспорт отчёта в CSV', 'Backlog', 'UnStarted', ['DEMO-7']),
  ]
  return {
    startedAt: ago(180),
    projects: ['ABC', 'DEMO', 'XYZ'],
    chain: {
      active: {
        project: 'ABC',
        current: { task: 'ABC-3', sessionId: null, since: ago(42) },
        paused: false,
        error: null,
      },
      queue: ['DEMO'],
      projects: {
        ABC: { order: ['ABC-3', 'ABC-4', 'ABC-5'], error: null },
        DEMO: { order: ['DEMO-7', 'DEMO-8'], error: null },
        XYZ: { order: [], error: null },
      },
    },
    tasks,
    sessions: [session('ABC-3', 61_000), session('DEMO-7', 142_000, 'waiting')],
    limits: {
      fiveHour: { usedPercentage: 37, resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() },
      sevenDay: { usedPercentage: 64, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
      updatedAt: ago(0),
    },
    huly: fakeHuly(huly),
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
  let current: LiveSnapshot = { state: link === 'connecting' ? null : fakeState(huly), link }

  if (link === 'live') {
    setInterval(() => {
      const state = current.state!
      const sessions = state.sessions.map((view) =>
        view.lamp === 'working' ? { ...view, contextTokens: view.contextTokens + 800, lastActivityAt: ago(0) } : view,
      )
      const hulyNow = state.huly.state === 'live' ? { ...state.huly, lastOkAt: ago(0) } : state.huly
      current = { ...current, state: { ...state, sessions, huly: hulyNow } }
      for (const listener of listeners) listener()
    }, TICK_MS)
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot: () => current,
    retryNow: () => {},
  }
}
