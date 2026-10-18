import { describe, expect, it } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import type { HandoffSession } from './relay.js'

const handoff = (sessionId: string): HandoffSession => ({
  sessionId,
  agentId: sessionId.slice(0, 8),
  account: 'global',
  cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1',
  branch: 'abc-1/task',
  transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z',
  recent: [],
  lastMessage: 'Which one?',
  checkpoint: null,
})

const runningState = (): ChainState => ({
  ...emptyChainState(),
  active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z' }, paused: false, error: null }],
})

async function running(options: SetupOptions = {}) {
  const context = setup({ state: runningState(), waiting: new Set(['ABC-1']), busy: new Set(['ABC-1']), asked: { 'ABC-1': 'toolu_1' }, ...options })
  context.handoffs['ABC-1'] = handoff('old-session')
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await context.dispatcher.idle()
  return context
}

const refusal = (act: () => void): string | undefined => {
  try {
    act()
  } catch (error) {
    return noticeOf(error).code
  }
  return undefined
}

describe('Dispatcher on an answer', () => {
  it('resumes the waiting session with the reply and journals it', async () => {
    const { dispatcher, relays, journal, clock } = await running()
    clock.now = new Date('2026-09-26T13:00:00Z')

    dispatcher.answer('ABC', 'ABC-1', 'old-session', 'toolu_1', 'Answer: Blue')
    await dispatcher.idle()

    expect(relays).toEqual([{ kind: 'reply', task: 'ABC-1', sessionId: 'old-session', prompt: 'Answer: Blue' }])
    expect(dispatcher.state.active[0]?.current).toMatchObject({ sessionId: 'old-session', resumedAt: '2026-09-26T13:00:00.000Z' })
    expect(dispatcher.state.active[0]?.current?.starting).toBeUndefined()
    expect(dispatcher.state.active[0]?.current?.answering).toBeUndefined()
    expect(journal.at(-1)).toEqual({ at: '2026-09-26T13:00:00.000Z', project: 'ABC', task: 'ABC-1', sessionId: 'old-session', reason: 'answer', previous: 'old-session' })
  })

  it('marks the delivery as an answer to the same session, so the page shows no new session starting', async () => {
    const { dispatcher, saved } = await running()
    dispatcher.answer('ABC', 'ABC-1', 'old-session', 'toolu_1', 'Answer: Blue')
    await dispatcher.idle()
    const during = saved.map((state) => state.active[0]?.current).find((current) => current?.starting !== undefined)
    expect(during).toMatchObject({ sessionId: 'old-session', answering: true })
  })

  it('takes a plain reply to a session that ended its turn', async () => {
    const { dispatcher, relays } = await running({ waiting: new Set(), busy: new Set(), asked: {} })
    dispatcher.answer('ABC', 'ABC-1', 'old-session', null, 'Go with B')
    await dispatcher.idle()
    expect(relays.map((relay) => relay.prompt)).toEqual(['Go with B'])
  })

  it('refuses while the session works', async () => {
    const { dispatcher } = await running({ waiting: new Set() })
    expect(refusal(() => dispatcher.answer('ABC', 'ABC-1', 'old-session', 'toolu_1', 'x'))).toBe('answer.busy')
  })

  it('lets a plain message reach a working session whose hooks take mail, without a resume', async () => {
    const { dispatcher, relays } = await running({ waiting: new Set(), asked: {}, blocked: 'not signed in', limitReset: '2026-09-26T15:00:00.000Z' })
    expect(dispatcher.answerable('ABC', 'ABC-1', 'old-session', null, true).midTurn).toBe(true)
    expect(refusal(() => dispatcher.answerable('ABC', 'ABC-1', 'old-session', null))).toBe('answer.busy')
    expect(refusal(() => dispatcher.answerable('ABC', 'ABC-1', 'older-session', null, true))).toBe('answer.moved')
    await dispatcher.idle()
    expect(relays).toEqual([])
  })

  it('tells a waiting session from a working one for the mailbox', async () => {
    const { dispatcher } = await running()
    expect(dispatcher.answerable('ABC', 'ABC-1', 'old-session', 'toolu_1', true).midTurn).toBe(false)
  })

  it('refuses once the session moved on: another session, another question or none', async () => {
    const { dispatcher } = await running()
    expect(refusal(() => dispatcher.answer('ABC', 'ABC-1', 'older-session', 'toolu_1', 'x'))).toBe('answer.moved')
    expect(refusal(() => dispatcher.answer('ABC', 'ABC-1', 'old-session', 'toolu_0', 'x'))).toBe('answer.moved')
    expect(refusal(() => dispatcher.answer('ABC', 'ABC-1', 'old-session', null, 'x'))).toBe('answer.moved')
    const plain = await running({ waiting: new Set(), busy: new Set(), asked: {} })
    expect(refusal(() => plain.dispatcher.answer('ABC', 'ABC-1', 'old-session', 'toolu_1', 'x'))).toBe('answer.moved')
  })

  it('refuses a task that is not the current one of a chain', async () => {
    const { dispatcher } = await running()
    expect(refusal(() => dispatcher.answer('ABC', 'ABC-2', 'old-session', null, 'x'))).toBe('chain.notCurrent')
  })

  it('answers a session that lives on after its chain stopped', async () => {
    const { dispatcher, relays, journal, clock } = await running()
    dispatcher.stop('ABC')
    clock.now = new Date('2026-09-26T13:00:00Z')

    dispatcher.answer('ABC', 'ABC-1', 'old-session', 'toolu_1', 'Answer: Blue')
    await dispatcher.idle()

    expect(relays).toEqual([{ kind: 'reply', task: 'ABC-1', sessionId: 'old-session', prompt: 'Answer: Blue' }])
    expect(journal.at(-1)).toEqual({ at: '2026-09-26T13:00:00.000Z', project: 'ABC', task: 'ABC-1', sessionId: 'old-session', reason: 'answer', previous: 'old-session' })
    expect(dispatcher.state.active).toEqual([])
    expect(refusal(() => dispatcher.answer('ABC', 'ABC-1', 'older-session', 'toolu_1', 'x'))).toBe('answer.moved')
  })

  it('refuses while the limit is spent', async () => {
    const { dispatcher } = await running({ limitReset: '2026-09-26T15:00:00.000Z' })
    expect(refusal(() => dispatcher.answer('ABC', 'ABC-1', 'old-session', 'toolu_1', 'x'))).toBe('chain.limitSpent')
  })

  it('does not deliver twice when the session changed while the answer waited in line', async () => {
    const { dispatcher, relays } = await running()
    dispatcher.answer('ABC', 'ABC-1', 'old-session', 'toolu_1', 'first')
    dispatcher.state.active[0]!.current!.sessionId = 'other-session'
    await dispatcher.idle()
    expect(relays).toEqual([])
  })
})
