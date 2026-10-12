import { describe, expect, it } from 'vitest'
import { blockedAsk, blockedOn, lampOf, parseAgents, parseSessionRecord, sessionsByTask, turnStatus, withLiveRecords, type AgentEntry } from './agents.js'

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

/** A background job as `claude agents --json` prints it with no live `sessions/<pid>.json` behind it. */
const { pid: _pid, status: _status, ...jobOnly } = background

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

describe('parseSessionRecord', () => {
  it('reads the pid, session, status, name and origin a running session writes to sessions/<pid>.json', () => {
    const raw = JSON.stringify({ pid: 4436, sessionId: 's1', cwd: 'C:\\x', kind: 'bg', status: 'busy', name: 'ABC-1', entrypoint: 'cli' })

    expect(parseSessionRecord(raw)).toEqual({ pid: 4436, sessionId: 's1', status: 'busy', name: 'ABC-1', cwd: 'C:\\x', entrypoint: 'cli' })
  })

  it('keeps what the session waits for', () => {
    const raw = JSON.stringify({ pid: 1, sessionId: 's1', status: 'waiting', waitingFor: 'permission' })

    expect(parseSessionRecord(raw)).toEqual({ pid: 1, sessionId: 's1', status: 'waiting', waitingFor: 'permission' })
  })

  it('keeps the status of a session that ended its turn while a background command runs', () => {
    expect(parseSessionRecord(JSON.stringify({ pid: 1, sessionId: 's1', status: 'shell' }))).toEqual({ pid: 1, sessionId: 's1', status: 'shell' })
  })

  it('drops an unknown status and rejects a record without pid or session', () => {
    expect(parseSessionRecord(JSON.stringify({ pid: 1, sessionId: 's1', status: 'dreaming' }))).toEqual({ pid: 1, sessionId: 's1' })
    expect(parseSessionRecord(JSON.stringify({ sessionId: 's1' }))).toBeUndefined()
    expect(parseSessionRecord(JSON.stringify({ pid: 1 }))).toBeUndefined()
    expect(parseSessionRecord('not json')).toBeUndefined()
  })
})

describe('blockedOn', () => {
  it('reads what a blocked job needs: a named dialog or the startup watchdog', () => {
    const mcp = { state: 'blocked', tempo: 'blocked', detail: '1 new MCP server needs approval', needs: 'approve 1 new project MCP server (strata) — attach to respond' }
    const wedge = { state: 'working', tempo: 'blocked', detail: 'stuck on a startup dialog', needs: 'open this session to continue setup' }

    expect(blockedOn(JSON.stringify(mcp))).toBe('approve 1 new project MCP server (strata) — attach to respond')
    expect(blockedOn(JSON.stringify(wedge))).toBe('open this session to continue setup')
    expect(blockedOn(JSON.stringify({ tempo: 'blocked', detail: 'stuck on a startup dialog' }))).toBe('stuck on a startup dialog')
  })

  it('names nothing for a job that is not blocked or a broken file', () => {
    expect(blockedOn(JSON.stringify({ state: 'working', tempo: 'idle', detail: 'starting…' }))).toBeNull()
    expect(blockedOn(JSON.stringify({ tempo: 'blocked' }))).toBeNull()
    expect(blockedOn('not json')).toBeNull()
    expect(blockedOn(undefined)).toBeNull()
  })
})

describe('blockedAsk', () => {
  const colour = { question: 'Which colour?', options: [{ label: 'Red', description: 'the warm one' }, { label: 'Blue', description: 'the cold one' }] }
  const job = (questions: unknown[]) => JSON.stringify({ state: 'working', tempo: 'blocked', needs: 'answer: Which colour? (Red · Blue)', block: { questions } })

  it('reads the question a blocked job waits on, which the transcript does not have yet', () => {
    const ask = blockedAsk(job([colour]), 'k3x9')

    expect(ask?.unsaved).toBe(true)
    expect(ask?.id).toMatch(/^job:k3x9:/)
    expect(ask?.questions).toEqual([{ question: 'Which colour?', header: '', multiSelect: false, options: colour.options }])
  })

  it('tells the next question of the job from the previous one', () => {
    const next = { question: 'Which layout?', options: [{ label: 'Rows', description: '' }] }

    expect(blockedAsk(job([next]), 'k3x9')?.id).not.toBe(blockedAsk(job([colour]), 'k3x9')?.id)
    expect(blockedAsk(job([colour]), 'k3x9')?.id).toBe(blockedAsk(job([colour]), 'k3x9')?.id)
  })

  it('finds no question in a job that is not blocked, waits on something else, or a broken file', () => {
    expect(blockedAsk(JSON.stringify({ tempo: 'active', block: { questions: [colour] } }), 'k3x9')).toBeNull()
    expect(blockedAsk(JSON.stringify({ tempo: 'blocked', needs: 'open this session to continue setup' }), 'k3x9')).toBeNull()
    expect(blockedAsk(job([]), 'k3x9')).toBeNull()
    expect(blockedAsk('not json', 'k3x9')).toBeNull()
    expect(blockedAsk(undefined, 'k3x9')).toBeNull()
  })
})

describe('withLiveRecords', () => {
  const job: AgentEntry = { id: '4174bd8f', cwd: 'C:\\x', kind: 'background', startedAt: 1, sessionId: 's1', state: 'done' }

  it('gives a background job the pid and status of its running process', () => {
    const records = [{ pid: 33836, sessionId: 's1', status: 'idle' as const }]

    expect(withLiveRecords([job], records)).toEqual([{ ...job, pid: 33836, status: 'idle' }])
  })

  it('leaves a job without a running process as it is', () => {
    expect(withLiveRecords([job], [{ pid: 1, sessionId: 'other', status: 'busy' }])).toEqual([job])
  })

  it('keeps what claude agents already printed', () => {
    const printed = { ...job, pid: 7, status: 'waiting' as const, waitingFor: 'permission' }

    expect(withLiveRecords([printed], [{ pid: 8, sessionId: 's1', status: 'busy' }])).toEqual([printed])
  })

  it('tells a printed busy session from one whose turn ended with a background command left running', () => {
    const printed = { ...job, pid: 7, status: 'busy' as const }

    expect(withLiveRecords([printed], [{ pid: 7, sessionId: 's1', status: 'shell' }])).toEqual([{ ...printed, status: 'shell' }])
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

  it('falls back to the issue branch the session works on when its name is free', () => {
    const branches: Record<string, string> = {
      manual: 'abc-3/session-panel',
      bare: 'abc-4',
      named: 'abc-5/other',
      main: 'main',
      foreign: 'xyz-6/fix',
      nested: 'feature/abc-7',
    }
    const agents = Object.keys(branches).map((sessionId) => ({
      ...interactive,
      sessionId,
      name: sessionId === 'named' ? 'ABC-2' : 'session-2b',
    }))

    const byTask = sessionsByTask(agents, ['ABC'], (agent) => branches[agent.sessionId] ?? null)

    expect([...byTask].map(([task, agent]) => `${task}=${agent.sessionId}`)).toEqual([
      'ABC-2=named',
      'ABC-3=manual',
      'ABC-4=bare',
    ])
  })

  it('prefers the session named after the issue to a later one that only sits on its branch', () => {
    const named = { ...interactive, sessionId: 'named', startedAt: 1 }
    const onBranch = { ...interactive, sessionId: 'on-branch', name: 'Check ABC-2', startedAt: 2 }

    const byTask = sessionsByTask([onBranch, named], ['ABC'], (agent) => (agent === onBranch ? 'abc-1/fix' : null))

    expect(byTask.get('ABC-1')?.sessionId).toBe('named')
  })

  it('tracks the fix session of main by its name or its branch, for a configured project only', () => {
    const named = { ...interactive, sessionId: 'named', name: 'ABC-FIX' }
    const onBranch = { ...interactive, sessionId: 'on-branch', name: 'session-2b' }
    const foreign = { ...interactive, sessionId: 'foreign', name: 'HOT-FIX' }

    expect(sessionsByTask([named, foreign], ['ABC']).get('ABC-FIX')?.sessionId).toBe('named')
    expect([...sessionsByTask([onBranch, foreign], ['ABC'], (agent) => (agent === onBranch ? 'abc-fix/task' : null)).keys()]).toEqual(['ABC-FIX'])
  })
})

describe('turnStatus', () => {
  const now = new Date('2026-09-26T12:00:00Z')

  it('counts a session waiting for its own background command as busy, even through a long run', () => {
    expect(turnStatus('shell', '2026-09-26T11:01:00.000Z', now)).toBe('busy')
    expect(turnStatus('shell', null, now)).toBe('busy')
  })

  it('takes a background command silent for an hour for a hung one, and the session for idle', () => {
    expect(turnStatus('shell', '2026-09-26T11:00:00.000Z', now)).toBe('idle')
  })

  it('takes a session whose turn ended on a limit for idle, whatever its background command does', () => {
    expect(turnStatus('shell', '2026-09-26T11:59:00.000Z', now, true)).toBe('idle')
    expect(turnStatus('busy', '2026-09-26T11:59:00.000Z', now, true)).toBe('busy')
  })

  it('leaves the other statuses as they are', () => {
    expect(turnStatus('busy', '2026-09-26T08:00:00.000Z', now)).toBe('busy')
    expect(turnStatus('waiting', null, now)).toBe('waiting')
    expect(turnStatus(undefined, null, now)).toBeUndefined()
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

  it('is working while a background command of an ended turn runs', () => {
    expect(lampOf({ ...background, status: 'shell' }, null)).toBe('working')
    expect(lampOf({ ...background, status: 'shell' }, 'error')).toBe('working')
  })

  it('shows the limit a turn ended on even while its background command still runs', () => {
    expect(lampOf({ ...background, status: 'shell' }, 'limit')).toBe('limit')
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

  it('takes a job without a live process for finished once its launch is long over, whatever its state says', () => {
    expect(lampOf(jobOnly, null, background.startedAt + 6 * 60_000)).toBe('finished')
    expect(lampOf({ ...jobOnly, state: 'blocked' }, null, background.startedAt + 6 * 60_000)).toBe('waiting')
  })

  it('keeps a fresh job without a process yet working', () => {
    expect(lampOf(jobOnly, null, background.startedAt + 60_000)).toBe('working')
  })
})
