import { describe, expect, it } from 'vitest'
import { taskSession } from './state.js'
import type { SessionView } from '../../src/state.js'

function view(sessionId: string, lamp: SessionView['lamp'], startedAt: string, task = 'ABC-1'): SessionView {
  return {
    task,
    sessionId,
    agent: 'claude',
    effort: null,
    model: null,
    cwd: '/repos/example',
    branch: null,
    lamp,
    checkpoint: false,
    waitingFor: null,
    startupDialog: null,
    hungSince: null,
    asking: false,
    ask: null,
    apiError: null,
    apiErrorKind: null,
    startedAt,
    lastActivityAt: null,
    contextTokens: 0,
    contextWindow: null,
    cache: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    stage: null,
    action: null,
    feed: [],
    remoteUrl: null,
    remoteOff: null,
    account: null,
  }
}

describe('taskSession', () => {
  it('takes the newest finished session, not the last one in the list', () => {
    // The hub's sessions come first, a machine elsewhere's after them.
    const hub = view('hub-new', 'finished', '2026-01-01T08:26:00.000Z')
    const machine = view('machine-old', 'finished', '2026-01-01T03:00:00.000Z')
    expect(taskSession([hub, machine], 'ABC-1')?.sessionId).toBe('hub-new')
    expect(taskSession([machine, hub], 'ABC-1')?.sessionId).toBe('hub-new')
  })

  it('takes an unfinished session over newer finished ones', () => {
    const live = view('live', 'working', '2026-01-01T03:00:00.000Z')
    const done = view('done', 'finished', '2026-01-01T08:26:00.000Z')
    expect(taskSession([done, live], 'ABC-1')?.sessionId).toBe('live')
  })

  it('leaves out other tasks and gives nothing without a session', () => {
    const other = view('other', 'finished', '2026-01-01T09:00:00.000Z', 'ABC-2')
    expect(taskSession([other, view('own', 'finished', '2026-01-01T08:00:00.000Z')], 'ABC-1')?.sessionId).toBe('own')
    expect(taskSession([other], 'ABC-1')).toBeUndefined()
  })
})
