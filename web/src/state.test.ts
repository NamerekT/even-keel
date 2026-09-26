import { describe, expect, it } from 'vitest'
import type { HulyTask, StatusCategory } from '../../src/huly/model.js'
import type { BatonState, SessionView } from '../../src/state.js'
import { cardTask, chainProgress, chainStatus, projectSlot, taskProject, waitingSessions } from './state.js'

function view(task: string, lamp: SessionView['lamp'], lastActivityAt: string | null): SessionView {
  return {
    task,
    sessionId: `session-${task}`,
    cwd: 'C:\\repos\\example',
    lamp,
    waitingFor: null,
    apiError: null,
    startedAt: '2026-01-01T09:00:00.000Z',
    lastActivityAt,
    contextTokens: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    stage: null,
    action: null,
    feed: [],
    remoteUrl: null,
  }
}

function task(id: string, category: StatusCategory = 'Active'): HulyTask {
  return { id, title: id, status: { name: category, category }, blockedBy: [] }
}

function baton(patch: Partial<BatonState>): BatonState {
  return {
    startedAt: '2026-01-01T08:00:00.000Z',
    projects: ['ABC', 'XYZ'],
    chain: { active: null, queue: [], projects: {} },
    tasks: [],
    sessions: [],
    limits: null,
    huly: { state: 'live', lastOkAt: null, error: null },
    launches: [],
    ...patch,
  }
}

const chain = (patch: Partial<BatonState['chain']>): BatonState['chain'] => ({
  active: null,
  queue: [],
  projects: {},
  ...patch,
})

describe('waitingSessions', () => {
  it('keeps only the sessions waiting for an answer, the longest waiting first', () => {
    const sessions = [
      view('ABC-1', 'working', '2026-01-01T10:00:00.000Z'),
      view('ABC-2', 'waiting', '2026-01-01T10:30:00.000Z'),
      view('DEMO-3', 'waiting', '2026-01-01T10:10:00.000Z'),
      view('DEMO-4', 'error', '2026-01-01T10:00:00.000Z'),
      view('DEMO-5', 'finished', '2026-01-01T09:00:00.000Z'),
    ]
    const tasks = ['ABC-1', 'ABC-2', 'DEMO-3', 'DEMO-4', 'DEMO-5'].map((id) => task(id))
    expect(waitingSessions(sessions, tasks).map((session) => session.task)).toEqual(['DEMO-3', 'ABC-2'])
  })

  it('leaves out sessions whose task is closed or no longer among the open ones', () => {
    const sessions = [
      view('ABC-1', 'waiting', '2026-01-01T10:00:00.000Z'),
      view('ABC-2', 'waiting', '2026-01-01T10:00:00.000Z'),
      view('ABC-3', 'waiting', '2026-01-01T10:00:00.000Z'),
    ]
    const tasks = [task('ABC-1'), task('ABC-2', 'Won')]
    expect(waitingSessions(sessions, tasks).map((session) => session.task)).toEqual(['ABC-1'])
  })

  it('falls back to the start time when a session has no activity yet', () => {
    const sessions = [view('ABC-1', 'waiting', '2026-01-01T09:30:00.000Z'), view('ABC-2', 'waiting', null)]
    expect(waitingSessions(sessions, [task('ABC-1'), task('ABC-2')]).map((session) => session.task)).toEqual([
      'ABC-2',
      'ABC-1',
    ])
  })
})

describe('taskProject', () => {
  it('takes the project key off a task id', () => {
    expect(taskProject('ABC-12')).toBe('ABC')
    expect(taskProject('MY_KEY2-3')).toBe('MY_KEY2')
  })
})

describe('chainProgress', () => {
  it('counts done tasks against all but the canceled ones', () => {
    const tasks = [task('ABC-1', 'Won'), task('ABC-2', 'Won'), task('ABC-3', 'Lost'), task('ABC-4'), task('ABC-5', 'ToDo')]
    expect(chainProgress(tasks)).toEqual({ done: 2, total: 4 })
  })

  it('is zero of zero with no tasks', () => {
    expect(chainProgress([])).toEqual({ done: 0, total: 0 })
  })
})

describe('chainStatus', () => {
  const active = (patch: { paused?: boolean; error?: string | null } = {}) => ({
    project: 'ABC',
    current: null,
    paused: patch.paused ?? false,
    error: patch.error ?? null,
  })

  it('tells a running chain from a paused one', () => {
    expect(chainStatus(chain({ active: active() }), 'ABC')).toEqual({ kind: 'running' })
    expect(chainStatus(chain({ active: active({ paused: true }) }), 'ABC')).toEqual({ kind: 'paused', error: null })
    expect(chainStatus(chain({ active: active({ paused: true, error: 'boom' }) }), 'ABC')).toEqual({
      kind: 'paused',
      error: 'boom',
    })
  })

  it('gives a queued chain its place in the queue, counting from one', () => {
    expect(chainStatus(chain({ active: active(), queue: ['DEMO', 'XYZ'] }), 'XYZ')).toEqual({ kind: 'queued', position: 2 })
  })

  it('calls any other chain idle', () => {
    expect(chainStatus(chain({ active: active(), queue: ['DEMO'] }), 'XYZ')).toEqual({ kind: 'idle' })
  })
})

describe('cardTask', () => {
  const orders = { ABC: { order: ['ABC-3', 'ABC-4'], error: null } }

  it('shows the current task of the active chain with the lamp of its session', () => {
    const state = baton({
      tasks: [task('ABC-3'), task('ABC-4')],
      sessions: [view('ABC-3', 'finished', null), view('ABC-3', 'waiting', null)],
      chain: chain({
        active: { project: 'ABC', current: { task: 'ABC-3', sessionId: 's', since: 't' }, paused: false, error: null },
        projects: orders,
      }),
    })
    expect(cardTask(state, 'ABC')).toEqual({ id: 'ABC-3', title: 'ABC-3', lamp: 'waiting', next: false })
  })

  it('shows the first task in order as the next one when nothing runs, grey without a session', () => {
    const state = baton({ tasks: [task('ABC-3'), task('ABC-4')], chain: chain({ projects: orders }) })
    expect(cardTask(state, 'ABC')).toEqual({ id: 'ABC-3', title: 'ABC-3', lamp: 'idle', next: true })
  })

  it('takes the lamp of a finished session when there is no other', () => {
    const state = baton({
      tasks: [task('ABC-3')],
      sessions: [view('ABC-3', 'finished', null)],
      chain: chain({ projects: orders }),
    })
    expect(cardTask(state, 'ABC')?.lamp).toBe('finished')
  })

  it('has no task when the chain is empty or not built yet', () => {
    expect(cardTask(baton({ chain: chain({ projects: { ABC: { order: [], error: null } } }) }), 'ABC')).toBeNull()
    expect(cardTask(baton({}), 'ABC')).toBeNull()
  })

  it('keeps a task Huly has not delivered yet, without a title', () => {
    const state = baton({ chain: chain({ projects: orders }) })
    expect(cardTask(state, 'ABC')).toEqual({ id: 'ABC-3', title: null, lamp: 'idle', next: true })
  })
})

describe('projectSlot', () => {
  it('numbers projects from one in config order and gives none past the eighth', () => {
    const projects = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
    expect(projectSlot(projects, 'A')).toBe(1)
    expect(projectSlot(projects, 'H')).toBe(8)
    expect(projectSlot(projects, 'I')).toBeNull()
    expect(projectSlot(projects, 'Z')).toBeNull()
  })
})
