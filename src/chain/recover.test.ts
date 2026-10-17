import { describe, expect, it } from 'vitest'
import { setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState, type CurrentTask } from './dispatcher.js'
import type { HandoffSession, LimitedSession } from './relay.js'

const handoff = (sessionId: string, overrides: Partial<HandoffSession> = {}): HandoffSession => ({
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
  ...overrides,
})

const STARTING = '2026-09-26T11:55:00.000Z'

// The current task as a service restart left it: a transition began, its end was never saved.
const cut = (move: Partial<CurrentTask>): ChainState => ({
  ...emptyChainState(),
  active: [
    {
      project: 'ABC',
      current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z', starting: STARTING, ...move },
      paused: false,
      error: null,
    },
  ],
})

const answer: Partial<CurrentTask> = { move: 'answer', answering: true, reply: 'Answer: Blue', ask: 'toolu_1' }

async function resumed(state: ChainState, session: HandoffSession | undefined, options: SetupOptions = {}) {
  const context = setup({ state, ...options })
  if (session !== undefined) context.handoffs['ABC-1'] = session
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await context.dispatcher.idle()
  return context
}

const marks = (current: CurrentTask | null | undefined) => ({
  starting: current?.starting,
  move: current?.move,
  reply: current?.reply,
  ask: current?.ask,
  answering: current?.answering,
})
const cleared = { starting: undefined, move: undefined, reply: undefined, ask: undefined, answering: undefined }

describe('Dispatcher after a service restart cut a transition short', () => {
  it('delivers an answer again when the session never got it', async () => {
    const { dispatcher, relays, journal } = await resumed(cut(answer), handoff('old-session'))
    expect(relays).toEqual([{ kind: 'reply', task: 'ABC-1', sessionId: 'old-session', prompt: 'Answer: Blue' }])
    expect(journal.at(-1)).toMatchObject({ task: 'ABC-1', sessionId: 'old-session', reason: 'answer', previous: 'old-session' })
    expect(marks(dispatcher.state.active[0]?.current)).toEqual(cleared)
  })

  it('takes an answer as delivered once the session works on it', async () => {
    const { dispatcher, relays, journal } = await resumed(cut(answer), handoff('old-session'), { busy: new Set(['ABC-1']) })
    expect(relays).toEqual([])
    expect(journal).toEqual([{ at: STARTING, project: 'ABC', task: 'ABC-1', sessionId: 'old-session', reason: 'answer', previous: 'old-session' }])
    expect(dispatcher.state.active[0]?.current).toMatchObject({ sessionId: 'old-session', resumedAt: STARTING })
    expect(marks(dispatcher.state.active[0]?.current)).toEqual(cleared)
  })

  it('takes an answer as delivered once the session replied after it', async () => {
    const { relays, journal } = await resumed(cut(answer), handoff('old-session', { lastReplyAt: '2026-09-26T11:58:00.000Z' }))
    expect(relays).toEqual([])
    expect(journal.map((entry) => entry.reason)).toEqual(['answer'])
  })

  it('takes an answer as delivered once the session waits on another question', async () => {
    const waiting = { busy: new Set(['ABC-1']), waiting: new Set(['ABC-1']), asked: { 'ABC-1': 'toolu_2' } }
    const { relays, journal } = await resumed(cut(answer), handoff('old-session'), waiting)
    expect(relays).toEqual([])
    expect(journal.map((entry) => entry.reason)).toEqual(['answer'])
  })

  it('delivers the answer again while the session still waits on the question it answers', async () => {
    const waiting = { busy: new Set(['ABC-1']), waiting: new Set(['ABC-1']), asked: { 'ABC-1': 'toolu_1' } }
    const { relays } = await resumed(cut(answer), handoff('old-session'), waiting)
    expect(relays.map((relay) => relay.prompt)).toEqual(['Answer: Blue'])
  })

  it('adopts the new session a cut "New session" already started and journals it', async () => {
    const { dispatcher, relays, journal } = await resumed(cut({ move: 'restart' }), handoff('session-9'))
    expect(relays).toEqual([])
    expect(journal).toEqual([{ at: STARTING, project: 'ABC', task: 'ABC-1', sessionId: 'session-9', reason: 'restart', previous: 'old-session' }])
    expect(dispatcher.state.active[0]?.current).toMatchObject({ sessionId: 'session-9', resumedAt: STARTING })
    expect(marks(dispatcher.state.active[0]?.current)).toEqual(cleared)
  })

  it('starts the new session again when a cut "New session" only stopped the old one', async () => {
    const { dispatcher, relays, journal } = await resumed(cut({ move: 'restart' }), handoff('old-session'))
    expect(relays).toMatchObject([{ kind: 'relay', sessionId: 'old-session', reason: 'restart' }])
    expect(journal.at(-1)).toMatchObject({ sessionId: 'session-1', reason: 'restart', previous: 'old-session' })
    expect(dispatcher.state.active[0]?.current?.sessionId).toBe('session-1')
  })

  it('hands over again after a limit when the cut relay did not start the new session', async () => {
    const session: LimitedSession = {
      ...handoff('old-session'),
      limit: { at: '2026-09-26T11:30:00.000Z', text: "You've hit your session limit · resets 11:50am (UTC)" },
    }
    const limit = { at: session.limit.at, account: 'john@example.com', resetsAt: '2026-09-26T11:50:00.000Z', lastReplyAt: '2026-09-26T10:00:00.000Z', then: 'relay' as const, acted: 'relay' as const }
    const { dispatcher, relays } = await resumed(cut({ move: 'relay', limit }), session, { limited: { 'ABC-1': session } })
    expect(relays).toMatchObject([{ kind: 'relay', sessionId: 'old-session', reason: 'limit' }])
    expect(dispatcher.state.active[0]?.current?.sessionId).toBe('session-1')
  })

  it('leaves a cut checkpoint hand-over to the checkpoint that is still there', async () => {
    const { dispatcher, relays } = await resumed(cut({ move: 'checkpoint' }), handoff('old-session', { checkpoint: '.temp/handoff.md' }))
    expect(relays).toMatchObject([{ kind: 'relay', sessionId: 'old-session', reason: 'checkpoint' }])
    expect(marks(dispatcher.state.active[0]?.current)).toEqual(cleared)
  })

  it('waits while no session of the task is read yet', async () => {
    const { dispatcher, relays, journal } = await resumed(cut(answer), undefined)
    expect(relays).toEqual([])
    expect(journal).toEqual([])
    expect(dispatcher.state.active[0]?.current).toMatchObject({ starting: STARTING, move: 'answer', reply: 'Answer: Blue' })
  })
})
