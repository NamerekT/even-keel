import { describe, expect, it } from 'vitest'
import type { AgentEntry } from './agents.js'
import { Lingering } from './lingering.js'

const entry = (sessionId: string, extra: Partial<AgentEntry> = {}): AgentEntry => ({
  id: sessionId,
  sessionId,
  kind: 'script',
  cwd: 'D:/repo/.claude/worktrees/abc-1',
  startedAt: 0,
  name: 'ABC-1',
  account: 'global',
  ...extra,
})
const busy = (agent: AgentEntry) => agent.status === 'busy' || agent.status === 'waiting'

describe('Lingering', () => {
  it('holds a kept session while its turn runs and gives it once the turn ends', () => {
    const lingering = new Lingering()
    lingering.keep('ABC-1', 'session-1')
    expect(lingering.due([entry('session-1', { pid: 1, status: 'busy' })], busy)).toEqual([])

    const rested = entry('session-1', { status: 'idle', resting: true })
    expect(lingering.due([rested], busy)).toEqual([{ task: 'ABC-1', agent: rested }])
    expect(lingering.due([rested], busy)).toEqual([])
  })

  it('does not give a session that waits for a reply', () => {
    const lingering = new Lingering()
    lingering.keep('ABC-1', 'session-1')
    expect(lingering.due([entry('session-1', { pid: 1, status: 'waiting' })], busy)).toEqual([])
  })

  it('forgets a kept session that is gone or ended on its own', () => {
    const lingering = new Lingering()
    lingering.keep('ABC-1', 'session-1')
    lingering.keep('ABC-1', 'session-2')
    expect(lingering.due([entry('session-2', { state: 'stopped' })], busy)).toEqual([])
    expect(lingering.due([entry('session-1', { status: 'idle', resting: true }), entry('session-2', { status: 'idle', resting: true })], busy)).toEqual([])
  })

  it('gives a session whose stop timed out with its retry, to be kept again if the stop times out once more (EKR-99)', () => {
    const lingering = new Lingering()
    const retry = { project: 'project-1', until: 1_000 }
    lingering.keep('ABC-1', 'session-1', retry)
    const rested = entry('session-1', { status: 'idle', resting: true })
    expect(lingering.due([rested], busy)).toEqual([{ task: 'ABC-1', agent: rested, retry }])
    expect(lingering.due([rested], busy)).toEqual([])
  })
})

describe('Lingering folders', () => {
  const folder = { project: 'project-1', task: 'ABC-1', repo: 'D:/repo', path: 'D:/repo/.claude/worktrees/abc-1', until: 1_000 }

  it('holds a left folder while a session of its task is kept and gives it once', () => {
    const lingering = new Lingering()
    lingering.keep('ABC-1', 'session-1', { project: 'project-1', until: 1_000 })
    lingering.leave(folder)
    expect(lingering.dueFolders(0)).toEqual([])

    lingering.due([entry('session-1', { status: 'idle', resting: true })], busy)
    expect(lingering.dueFolders(0)).toEqual([folder])
    expect(lingering.dueFolders(0)).toEqual([])
  })

  it('gives a left folder once its wait is over, though a session of its task is still kept', () => {
    const lingering = new Lingering()
    lingering.keep('ABC-1', 'session-1')
    lingering.leave(folder)
    expect(lingering.dueFolders(999)).toEqual([])
    expect(lingering.dueFolders(1_000)).toEqual([folder])
  })

  it('does not hold a folder for a session of another task', () => {
    const lingering = new Lingering()
    lingering.keep('ABC-2', 'session-2')
    lingering.leave(folder)
    expect(lingering.dueFolders(0)).toEqual([folder])
  })
})

describe('Lingering.alone', () => {
  it('skips a run while the previous one is under way', async () => {
    const lingering = new Lingering()
    let release = () => {}
    const runs: number[] = []
    const first = lingering.alone(async () => {
      runs.push(1)
      await new Promise<void>((resolve) => (release = resolve))
    })
    await lingering.alone(async () => void runs.push(2))
    release()
    await first
    await lingering.alone(async () => void runs.push(3))
    expect(runs).toEqual([1, 3])
  })
})
