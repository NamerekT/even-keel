import { describe, expect, it } from 'vitest'
import { setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import type { HandoffSession, LimitedSession } from './relay.js'

const session = (lastReplyAt: string | null, changes: Partial<HandoffSession> = {}): HandoffSession => ({
  sessionId: 'old-session',
  agentId: 'old-sess',
  account: 'global',
  cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1',
  branch: 'abc-1/task',
  transcript: null,
  lastReplyAt,
  recent: [],
  lastMessage: 'Which of the two layouts do you want?',
  checkpoint: null,
  ...changes,
})

const runningState = (since = '2026-09-26T11:00:00.000Z'): ChainState => ({
  ...emptyChainState(),
  active: { project: 'ABC', current: { task: 'ABC-1', sessionId: 'old-session', since }, paused: false, error: null },
})

async function running(options: SetupOptions, handoff: HandoffSession | undefined, state = runningState()) {
  const context = setup({ state, unattended: true, ...options })
  if (handoff !== undefined) context.handoffs['ABC-1'] = handoff
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await context.dispatcher.idle()
  return context
}

describe('Dispatcher in the unattended mode', () => {
  it('skips the current task whose session ended its turn ten minutes ago and launches the next', async () => {
    const { dispatcher, journal, launched } = await running({}, session('2026-09-26T11:50:00.000Z'))

    expect(dispatcher.state.skipped).toEqual({ ABC: ['ABC-1'] })
    expect(dispatcher.state.released).toEqual({ ABC: ['ABC-1'] })
    expect(journal[0]).toEqual({ at: '2026-09-26T12:00:00.000Z', project: 'ABC', task: 'ABC-1', sessionId: 'old-session', reason: 'skip' })
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('skips a session that waits for an answer, too', async () => {
    const { dispatcher } = await running({ waiting: new Set(['ABC-1']) },session('2026-09-26T11:50:00.000Z'))
    expect(dispatcher.state.skipped).toEqual({ ABC: ['ABC-1'] })
  })

  it('waits while the turn ended less than ten minutes ago', async () => {
    const { dispatcher, launched } = await running({}, session('2026-09-26T11:51:00.000Z'))
    expect(dispatcher.state.skipped).toEqual({})
    expect(launched).toEqual([])
  })

  it('counts the ten minutes from when the chain took the task', async () => {
    const { dispatcher } = await running({}, session('2026-09-26T10:00:00.000Z'), runningState('2026-09-26T11:55:00.000Z'))
    expect(dispatcher.state.skipped).toEqual({})
  })

  it('counts them anew from a resume after the usage limit', async () => {
    const state = runningState()
    state.active!.current!.resumedAt = '2026-09-26T11:55:00.000Z'
    const { dispatcher } = await running({}, session('2026-09-26T11:00:00.000Z'), state)
    expect(dispatcher.state.skipped).toEqual({})
  })

  it('is switched from the page and saved with the chain', async () => {
    const { dispatcher, saved, launched } = await running({ unattended: false }, session('2026-09-26T11:00:00.000Z'))
    expect(launched).toEqual([])

    dispatcher.setUnattended(true)
    await dispatcher.idle()
    expect(saved.at(-1)?.unattended).toBe(true)
    expect(dispatcher.state.skipped).toEqual({ ABC: ['ABC-1'] })
    expect(launched).toEqual(['ABC/ABC-2'])

    const count = saved.length
    dispatcher.setUnattended(true)
    expect(saved).toHaveLength(count)
  })

  it('does nothing outside the unattended mode', async () => {
    const { dispatcher } = await running({ unattended: false }, session('2026-09-26T11:00:00.000Z'))
    expect(dispatcher.state.skipped).toEqual({})
    expect(dispatcher.state.active?.current?.task).toBe('ABC-1')
  })

  it('leaves a session in the middle of its turn alone', async () => {
    const { dispatcher } = await running({ busy: new Set(['ABC-1']) }, session('2026-09-26T11:00:00.000Z'))
    expect(dispatcher.state.skipped).toEqual({})
  })

  it('leaves a session on the usage limit to the limit rule', async () => {
    const limited: LimitedSession = { ...session('2026-09-26T11:00:00.000Z'), limit: { at: '2026-09-26T11:00:00.000Z', text: 'limit' } }
    const { dispatcher } = await running({ limited: { 'ABC-1': limited }, account: { id: null, ready: true } }, limited)
    expect(dispatcher.state.skipped).toEqual({})
  })

  it('hands a checkpoint over instead of skipping', async () => {
    const { dispatcher, relays } = await running({}, session('2026-09-26T11:00:00.000Z', { checkpoint: '.temp/handoff.md' }))
    expect(dispatcher.state.skipped).toEqual({})
    expect(relays).toHaveLength(1)
  })

  it('ignores a session other than the current one', async () => {
    const { dispatcher } = await running({}, session('2026-09-26T11:00:00.000Z', { sessionId: 'another-session' }))
    expect(dispatcher.state.skipped).toEqual({})
  })
})
