import { describe, expect, it } from 'vitest'
import { textNotice } from '../notice/notice.js'
import { setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import type { HandoffSession, LimitedSession } from './relay.js'

const handoff = (sessionId: string, checkpoint: string | null = '.temp/handoff.md'): HandoffSession => ({
  sessionId,
  agentId: sessionId.slice(0, 8),
  account: 'global',
  cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1/src',
  branch: 'main',
  transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z',
  recent: [],
  lastMessage: 'Handoff is written.\n\nCHECKPOINT: .temp/handoff.md',
  checkpoint,
})

const runningState = (paused = false): ChainState => ({
  ...emptyChainState(),
  active: { project: 'ABC', current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z' }, paused, error: null },
})

const located = { workdir: 'D:/work/abc/.claude/worktrees/abc-1', branch: 'abc-1/work' }

async function running(options: SetupOptions = {}, session: HandoffSession = handoff('old-session')) {
  const context = setup({ state: runningState(), located, ...options })
  context.handoffs['ABC-1'] = session
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await context.dispatcher.idle()
  return context
}

describe('Dispatcher on a checkpoint', () => {
  it('hands the current task to a new session in the same worktree and journals the checkpoint', async () => {
    const { dispatcher, relays, journal } = await running()

    expect(relays).toMatchObject([{ kind: 'relay', task: 'ABC-1', sessionId: 'old-session', workdir: located.workdir }])
    expect(relays[0]?.prompt).toContain('контрольную точку')
    expect(relays[0]?.prompt).toContain('D:/work/abc/.claude/worktrees/abc-1/.temp/handoff.md')
    expect(dispatcher.state.active?.current).toMatchObject({ task: 'ABC-1', sessionId: 'session-1' })
    expect(journal.at(-1)).toEqual({
      at: '2026-09-26T12:00:00.000Z',
      project: 'ABC',
      task: 'ABC-1',
      sessionId: 'session-1',
      reason: 'checkpoint',
      previous: 'old-session',
    })
  })

  it('does not hand over again once the new session took the task', async () => {
    const { dispatcher, relays } = await running()
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toHaveLength(1)
  })

  it('hands over again when the new session checkpoints in its turn', async () => {
    const { dispatcher, relays, journal, handoffs } = await running()
    handoffs['ABC-1'] = handoff('session-1')
    dispatcher.check()
    await dispatcher.idle()

    expect(relays.map((relay) => relay.sessionId)).toEqual(['old-session', 'session-1'])
    expect(journal.at(-1)).toMatchObject({ sessionId: 'session-2', reason: 'checkpoint', previous: 'session-1' })
    expect(dispatcher.state.active?.current).toMatchObject({ sessionId: 'session-2' })
  })

  it('leaves a session without a checkpoint alone', async () => {
    const { relays } = await running({}, handoff('old-session', null))
    expect(relays).toEqual([])
  })

  it('ignores the checkpoint of a session other than the current one', async () => {
    const { relays } = await running({}, handoff('another-session'))
    expect(relays).toEqual([])
  })

  it('waits while the session is mid-turn', async () => {
    const { dispatcher, relays, busy } = await running({ busy: new Set(['ABC-1']) })
    expect(relays).toEqual([])

    busy.delete('ABC-1')
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toHaveLength(1)
  })

  it('waits for a paused chain and hands over once it is resumed', async () => {
    const { dispatcher, relays } = await running({ state: runningState(true) })
    expect(relays).toEqual([])

    dispatcher.resume()
    await dispatcher.idle()
    expect(relays).toHaveLength(1)
    expect(dispatcher.state.active).toMatchObject({ paused: false, current: { sessionId: 'session-1' } })
  })

  it('waits while new sessions cannot start', async () => {
    const blocked = await running({ blocked: 'claude: sign-in in progress' })
    expect(blocked.relays).toEqual([])
    expect(blocked.dispatcher.state.active).toMatchObject({ paused: false, current: { sessionId: 'old-session' } })

    const spent = await running({ limitReset: '2026-09-26T15:00:00.000Z' })
    expect(spent.relays).toEqual([])
  })

  it('leaves a limited session to the limit handoff, which still points at the note', async () => {
    const limited: LimitedSession = {
      ...handoff('old-session'),
      lastReplyAt: '2026-09-26T09:00:00.000Z',
      limit: { at: '2026-09-26T11:55:00.000Z', text: 'You have hit your limit' },
    }
    const waiting = await running({ limited: { 'ABC-1': limited } })
    expect(waiting.relays).toEqual([])

    const switched = await running({ limited: { 'ABC-1': limited }, accountAt: () => 'jane@example.com' })
    expect(switched.relays).toHaveLength(1)
    expect(switched.relays[0]?.prompt).toContain('лимит')
    expect(switched.relays[0]?.prompt).toContain('D:/work/abc/.claude/worktrees/abc-1/.temp/handoff.md')
    expect(switched.journal.at(-1)).toMatchObject({ reason: 'relay' })
  })

  it('halts the chain when the new session does not start', async () => {
    const { dispatcher } = await running({ failRelay: true })
    expect(dispatcher.state.active).toMatchObject({ paused: true, current: null, error: textNotice('claude: could not stop old-sess') })
  })
})
