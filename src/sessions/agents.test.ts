import { describe, expect, it } from 'vitest'
import { lampOf, parseAgents, sessionsByTask, type AgentEntry } from './agents.js'

const interactive: AgentEntry = {
  pid: 100,
  cwd: 'C:\\repos\\example-project',
  kind: 'interactive',
  startedAt: 1_790_000_000_000,
  sessionId: '00000000-0000-4000-8000-000000000001',
  name: 'ABC-1',
  status: 'idle',
}

const background: AgentEntry = { ...interactive, kind: 'background', id: 'k3x9', state: 'working' }

describe('parseAgents', () => {
  it('reads the entries claude agents --json prints and drops malformed ones', () => {
    const raw = JSON.stringify([
      interactive,
      { ...background, status: 'waiting', waitingFor: 'permission' },
      { cwd: 'C:\\x', kind: 'interactive' },
      'junk',
    ])

    expect(parseAgents(raw)).toEqual([interactive, { ...background, status: 'waiting', waitingFor: 'permission' }])
  })

  it('rejects output that is not a list', () => {
    expect(() => parseAgents('{"error":"nope"}')).toThrow(/agents/)
  })
})

describe('sessionsByTask', () => {
  it('keeps the latest session named after an issue of a configured project', () => {
    const older = { ...interactive, sessionId: 'older', startedAt: 1 }
    const newer = { ...background, sessionId: 'newer', startedAt: 2 }
    const agents = [
      newer,
      older,
      { ...interactive, sessionId: 'other-project', name: 'XYZ-1' },
      { ...interactive, sessionId: 'free-name', name: 'ABC-1 retry' },
      { ...interactive, sessionId: 'no-name', name: undefined },
      { ...interactive, sessionId: 'second', name: 'ABC-2' },
    ]

    const byTask = sessionsByTask(agents, ['ABC'])

    expect([...byTask.keys()]).toEqual(['ABC-1', 'ABC-2'])
    expect(byTask.get('ABC-1')?.sessionId).toBe('newer')
  })
})

describe('lampOf', () => {
  it('is finished when the session is gone or completed', () => {
    expect(lampOf(undefined, null)).toBe('finished')
    expect(lampOf({ ...background, state: 'done' }, null)).toBe('finished')
    expect(lampOf({ ...background, state: 'stopped' }, null)).toBe('finished')
  })

  it('is an error when the background job failed', () => {
    expect(lampOf({ ...background, state: 'failed', status: 'idle' }, null)).toBe('error')
  })

  it('is working while the session is busy, even right after an API error', () => {
    expect(lampOf({ ...interactive, status: 'busy' }, null)).toBe('working')
    expect(lampOf({ ...interactive, status: 'busy' }, 'limit')).toBe('working')
  })

  it('shows the API error the idle session stopped on', () => {
    expect(lampOf(interactive, 'limit')).toBe('limit')
    expect(lampOf(interactive, 'error')).toBe('error')
    expect(lampOf({ ...background, status: 'idle' }, 'limit')).toBe('limit')
  })

  it('waits for an answer on a question, a permission prompt or a finished turn', () => {
    expect(lampOf({ ...interactive, status: 'waiting', waitingFor: 'permission' }, null)).toBe('waiting')
    expect(lampOf({ ...background, state: 'blocked', status: undefined }, null)).toBe('waiting')
    expect(lampOf(interactive, null)).toBe('waiting')
  })

  it('trusts the job state when there is no process status', () => {
    expect(lampOf({ ...background, status: undefined }, null)).toBe('working')
  })
})
