import { describe, expect, it } from 'vitest'
import { setup, task } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import type { HandoffSession, LimitedSession } from './relay.js'

const handoff = (sessionId: string, overrides: Partial<HandoffSession> = {}): HandoffSession => ({
  sessionId,
  agentId: sessionId.slice(0, 8),
  account: 'global',
  cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1',
  branch: 'abc-1/work',
  transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z',
  recent: [],
  lastMessage: null,
  checkpoint: null,
  ...overrides,
})

const runningState = (): ChainState => ({
  ...emptyChainState(),
  active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z' }, paused: false, error: null }],
})

const startings = (saved: ChainState[]) => saved.map((state) => state.active[0]?.current?.starting)

describe('Dispatcher marks a session that is starting', () => {
  it('while it launches the first session of a task', async () => {
    const { dispatcher, saved } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    const during = saved.find((state) => state.active[0]?.current?.sessionId === null)
    expect(during?.active[0]?.current?.starting).toBe('2026-09-26T12:00:00.000Z')
    expect(dispatcher.state.active[0]?.current).toMatchObject({ sessionId: 'session-1' })
    expect(dispatcher.state.active[0]?.current?.starting).toBeUndefined()
  })

  it('while it hands the task over on a restart', async () => {
    const { dispatcher, saved, handoffs, clock } = setup({ state: runningState() })
    handoffs['ABC-1'] = handoff('old-session')
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.idle()
    clock.now = new Date('2026-09-26T13:00:00Z')

    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()

    expect(startings(saved)).toContain('2026-09-26T13:00:00.000Z')
    expect(dispatcher.state.active[0]?.current).toMatchObject({ sessionId: 'session-1' })
    expect(dispatcher.state.active[0]?.current?.starting).toBeUndefined()
  })

  it('while it hands the task over at a checkpoint', async () => {
    const { dispatcher, saved, handoffs } = setup({ state: runningState() })
    handoffs['ABC-1'] = handoff('old-session', { checkpoint: '.temp/handoff.md' })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.idle()

    expect(startings(saved)).toContain('2026-09-26T12:00:00.000Z')
    expect(dispatcher.state.active[0]?.current).toMatchObject({ sessionId: 'session-1' })
    expect(dispatcher.state.active[0]?.current?.starting).toBeUndefined()
  })

  it('while it hands the task over after a limit', async () => {
    const { dispatcher, saved, limited, clock } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    const session: LimitedSession = {
      ...handoff('session-1', { lastReplyAt: '2026-09-26T11:59:00.000Z' }),
      limit: { at: '2026-09-26T12:00:00.000Z', text: "You've hit your session limit · resets 3pm (UTC)" },
    }
    limited['ABC-1'] = session
    dispatcher.check()
    await dispatcher.idle()
    clock.now = new Date('2026-09-26T15:01:00Z')
    dispatcher.check()
    await dispatcher.idle()

    expect(startings(saved)).toContain('2026-09-26T15:01:00.000Z')
    expect(dispatcher.state.active[0]?.current).toMatchObject({ sessionId: 'session-2' })
    expect(dispatcher.state.active[0]?.current?.starting).toBeUndefined()
  })

  it('and drops the mark when the session does not start', async () => {
    const { dispatcher, handoffs } = setup({ state: runningState(), failRelay: true })
    handoffs['ABC-1'] = handoff('old-session')
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.idle()

    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()

    expect(dispatcher.state.active[0]).toMatchObject({ current: null, paused: true })
  })
})
