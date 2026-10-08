import { describe, expect, it } from 'vitest'
import { textNotice } from '../notice/notice.js'
import { setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import type { HandoffSession } from './relay.js'

const handoff = (sessionId: string): HandoffSession => ({
  sessionId,
  agentId: sessionId.slice(0, 8),
  account: 'global',
  cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1/tests',
  branch: 'main',
  transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z',
  recent: [],
  lastMessage: 'Left: run the tests.',
  checkpoint: null,
})

const runningState = (paused = false): ChainState => ({
  ...emptyChainState(),
  active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z' }, paused, error: null }],
})

async function running(options: SetupOptions = {}) {
  const context = setup({ state: runningState(), ...options })
  context.handoffs['ABC-1'] = handoff('old-session')
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await context.dispatcher.idle()
  return context
}

describe('Dispatcher on a restart', () => {
  it('hands the current task to a new session in the worktree git reports and journals the restart', async () => {
    const located = { workdir: 'D:/work/abc/.claude/worktrees/abc-1', branch: 'abc-1/work' }
    const { dispatcher, relays, journal, clock } = await running({ located })
    clock.now = new Date('2026-09-26T13:00:00Z')

    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()

    expect(relays).toMatchObject([{ kind: 'relay', task: 'ABC-1', sessionId: 'old-session', workdir: located.workdir }])
    expect(relays[0]?.prompt).toContain('abc-1/work')
    expect(relays[0]?.prompt).toContain('пользователь')
    expect(relays[0]?.prompt).toContain('Left: run the tests.')
    expect(dispatcher.state.active[0]?.current).toMatchObject({ task: 'ABC-1', sessionId: 'session-1' })
    expect(journal.at(-1)).toEqual({
      at: '2026-09-26T13:00:00.000Z',
      project: 'ABC',
      task: 'ABC-1',
      sessionId: 'session-1',
      reason: 'restart',
      previous: 'old-session',
    })
  })

  it('forgets the limit hold of the replaced session', async () => {
    const { dispatcher } = await running()
    const current = dispatcher.state.active[0]!.current!
    current.limit = {
      at: '2026-09-26T11:55:00.000Z',
      account: 'john@example.com',
      resetsAt: '2026-09-26T15:00:00.000Z',
      lastReplyAt: '2026-09-26T11:50:00.000Z',
      then: 'relay',
      acted: null,
    }

    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()
    expect(dispatcher.state.active[0]?.current?.limit).toBeUndefined()
  })

  it('restarts the task of a paused chain and leaves the chain paused', async () => {
    const { dispatcher, relays } = await running({ state: runningState(true) })
    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()
    expect(relays).toHaveLength(1)
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, current: { sessionId: 'session-1' } })
  })

  it('halts the chain when the new session does not start', async () => {
    const { dispatcher } = await running({ failRelay: true })
    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, current: null, error: textNotice('claude: could not stop old-sess') })
  })

  it('refuses while the session is mid-turn', async () => {
    const { dispatcher, relays } = await running({ busy: new Set(['ABC-1']) })
    expect(() => dispatcher.restart('ABC', 'ABC-1')).toThrow('chain: ABC-1 is mid-turn; wait until its session stops')
    await dispatcher.idle()
    expect(relays).toEqual([])
  })

  it('refuses a task that is not the current task of the chain', async () => {
    const { dispatcher } = await running()
    expect(() => dispatcher.restart('ABC', 'ABC-2')).toThrow('chain: ABC-2 is not the current task of a chain')
  })

  it('refuses while new sessions cannot start', async () => {
    const blocked = await running({ blocked: 'claude: sign-in in progress' })
    expect(() => blocked.dispatcher.restart('ABC', 'ABC-1')).toThrow('claude: sign-in in progress')

    const spent = await running({ limitReset: '2026-09-26T15:00:00.000Z' })
    expect(() => spent.dispatcher.restart('ABC', 'ABC-1')).toThrow('chain: the usage limit is spent until 2026-09-26T15:00:00.000Z')
  })

  it('refuses when no session of the task is known', async () => {
    const { dispatcher, handoffs } = await running()
    delete handoffs['ABC-1']
    expect(() => dispatcher.restart('ABC', 'ABC-1')).toThrow('chain: no session of ABC-1 is known')
  })
})
