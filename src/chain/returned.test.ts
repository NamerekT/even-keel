import { describe, expect, it } from 'vitest'
import { backlog, done, setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import type { HandoffSession } from './relay.js'

const session = (changes: Partial<HandoffSession> = {}): HandoffSession => ({
  sessionId: 'old-session',
  agentId: 'old-sess',
  account: 'global',
  cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1',
  branch: 'abc-1/task',
  transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z',
  recent: [],
  lastMessage: 'The question is in the comments: which of the two layouts?',
  checkpoint: null,
  ...changes,
})

const runningState = (): ChainState => ({
  ...emptyChainState(),
  active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z' }, paused: false, error: null }],
})

/** The session of ABC-1 ended its turn and the task went to Backlog; the chain let it go. */
async function shelved(options: SetupOptions = {}) {
  const context = setup({ state: runningState(), live: { 'ABC-1': 'old-session' }, ...options })
  context.handoffs['ABC-1'] = session()
  context.dispatcher.setTasks('ABC', [task('ABC-1', backlog)])
  await context.dispatcher.idle()
  return context
}

async function back(context: Awaited<ReturnType<typeof shelved>>) {
  context.clock.now = new Date('2026-09-26T14:00:00.000Z')
  context.dispatcher.setTasks('ABC', [task('ABC-1')])
  context.dispatcher.start('ABC')
  await context.dispatcher.idle()
}

describe('Dispatcher with a task back from an inactive status', () => {
  it('remembers the session of a task that left the chain after its turn', async () => {
    const { dispatcher } = await shelved()
    expect(dispatcher.state.shelved).toEqual({ ABC: [{ task: 'ABC-1', sessionId: 'old-session', at: '2026-09-26T12:00:00.000Z' }] })
    expect(dispatcher.state.released).toEqual({ ABC: ['ABC-1'] })
  })

  it('hands the task over to a new session once it is back, and the handover stops the old one', async () => {
    const context = await shelved()
    await back(context)
    const { dispatcher, relays, journal, launched } = context

    expect(launched).toEqual([])
    expect(relays).toHaveLength(1)
    expect(relays[0]).toMatchObject({ kind: 'relay', task: 'ABC-1', sessionId: 'old-session', reason: 'returned' })
    expect(relays[0]?.prompt).toContain('вернул её в цепочку')
    expect(relays[0]?.prompt).toContain('The question is in the comments')
    expect(journal).toEqual([{ at: '2026-09-26T14:00:00.000Z', project: 'ABC', task: 'ABC-1', sessionId: 'session-1', reason: 'relay', cause: 'returned', previous: 'old-session' }])
    expect(dispatcher.state.active[0]?.current).toMatchObject({ task: 'ABC-1', sessionId: 'session-1' })
    expect(dispatcher.state.shelved).toEqual({})
    expect(dispatcher.state.released).toEqual({})
  })

  it('adopts the old session when it is mid-turn by then', async () => {
    const context = await shelved()
    context.busy.add('ABC-1')
    await back(context)

    expect(context.relays).toEqual([])
    expect(context.dispatcher.state.active[0]?.current?.sessionId).toBe('old-session')
    expect(context.dispatcher.state.shelved).toEqual({})
  })

  it('adopts a session someone talked to after the task left', async () => {
    const context = await shelved()
    context.handoffs['ABC-1'] = session({
      lastReplyAt: '2026-09-26T13:01:00.000Z',
      recent: [
        { at: '2026-09-26T11:50:00.000Z', kind: 'prompt', text: 'ABC-1' },
        { at: '2026-09-26T13:00:00.000Z', kind: 'prompt', text: 'Take the first layout.' },
      ],
    })
    await back(context)

    expect(context.relays).toEqual([])
    expect(context.dispatcher.state.active[0]?.current?.sessionId).toBe('old-session')
  })

  it('does not remember a session that waits on a question of its own', async () => {
    const context = await shelved({ waiting: new Set(['ABC-1']), asked: { 'ABC-1': 'ask-1' } })
    expect(context.dispatcher.state.shelved).toEqual({})
    await back(context)
    expect(context.relays).toEqual([])
    expect(context.dispatcher.state.active[0]?.current?.sessionId).toBe('old-session')
  })

  it('keeps the task of a session still writing its last words, and remembers it once the turn ended', async () => {
    const context = await shelved({ busy: new Set(['ABC-1']) })
    expect(context.dispatcher.state.shelved).toEqual({})
    expect(context.dispatcher.state.active[0]?.current?.task).toBe('ABC-1')

    context.busy.delete('ABC-1')
    context.handoffs['ABC-1'] = session({ lastReplyAt: '2026-09-26T12:00:30.000Z' })
    context.dispatcher.setTasks('ABC', [task('ABC-1', backlog)])
    await context.dispatcher.idle()
    expect(context.dispatcher.state.shelved.ABC).toHaveLength(1)

    await back(context)
    expect(context.relays).toMatchObject([{ kind: 'relay', sessionId: 'old-session', reason: 'returned' }])
  })

  it('does not remember a task released for an open blocker', async () => {
    const context = setup({ state: runningState(), live: { 'ABC-1': 'old-session' } })
    context.dispatcher.setTasks('ABC', [task('ABC-2'), task('ABC-1', undefined, 'ABC-2')])
    await context.dispatcher.idle()
    expect(context.dispatcher.state.released).toEqual({ ABC: ['ABC-1'] })
    expect(context.dispatcher.state.shelved).toEqual({})
  })

  it('waits with the handover while no session may start', async () => {
    const context = await shelved({ limitReset: '2026-09-26T15:00:00.000Z' })
    await back(context)

    expect(context.relays).toEqual([])
    expect(context.dispatcher.state.active[0]?.current).toBeNull()
    expect(context.dispatcher.state.shelved.ABC).toHaveLength(1)
  })

  it('forgets the session once the task is done and cleaned up after', async () => {
    const context = await shelved()
    context.dispatcher.setReleased('ABC', [task('ABC-1', done)])
    await context.dispatcher.idle()
    expect(context.finished).toEqual(['ABC/ABC-1'])
    expect(context.dispatcher.state.shelved).toEqual({})
  })

  it('makes a handover a service restart cut short again', async () => {
    const state: ChainState = {
      ...emptyChainState(),
      active: [
        {
          project: 'ABC',
          current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z', starting: '2026-09-26T11:59:00.000Z', move: 'returned' },
          paused: false,
          error: null,
        },
      ],
    }
    const context = setup({ state, live: { 'ABC-1': 'old-session' } })
    context.handoffs['ABC-1'] = session()
    context.dispatcher.setTasks('ABC', [task('ABC-1')])
    await context.dispatcher.idle()

    expect(context.relays).toMatchObject([{ kind: 'relay', sessionId: 'old-session', reason: 'returned' }])
    expect(context.journal).toMatchObject([{ reason: 'relay', sessionId: 'session-1', previous: 'old-session' }])
  })
})
