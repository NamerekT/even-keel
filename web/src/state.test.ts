import { describe, expect, it } from 'vitest'
import type { HulyTask, StatusCategory } from '../../src/huly/model.js'
import type { SessionView } from '../../src/state.js'
import { taskProject, waitingSessions } from './state.js'

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
