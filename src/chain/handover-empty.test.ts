import { describe, expect, it } from 'vitest'
import type { FeedLine } from '../sessions/transcript.js'
import { setup, task } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import type { HandoffSession } from './relay.js'

const line = (text: string, kind: FeedLine['kind']): FeedLine => ({ at: '2026-10-31T10:00:00.000Z', kind, text })

const worked: HandoffSession = {
  sessionId: 'worked-session',
  agentId: 'worked',
  account: 'john',
  cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1',
  branch: 'abc-1/work',
  transcript: 'C:/accounts/john/projects/abc/worked-session.jsonl',
  lastReplyAt: '2026-10-31T10:00:00.000Z',
  recent: [line('ABC-1', 'prompt'), line('Edit src/host.test.ts', 'tool')],
  lastMessage: 'Next: make the host test pass.',
  checkpoint: null,
}

/** A session that failed before its first answer: its feed holds only its prompt and the API error. */
const empty = (sessionId: string, error = 'Invalid API key'): HandoffSession => ({
  ...worked,
  sessionId,
  agentId: sessionId,
  account: 'jane',
  transcript: `C:/accounts/jane/projects/abc/${sessionId}.jsonl`,
  lastReplyAt: null,
  recent: [line('ABC-1 handoff', 'prompt'), line(error, 'error')],
  lastMessage: null,
})

const runningState = (): ChainState => ({
  ...emptyChainState(),
  active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'worked-session', since: '2026-10-31T09:00:00.000Z' }, paused: false, error: null }],
})

async function running() {
  const context = setup({ state: runningState() })
  context.handoffs['ABC-1'] = worked
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await context.dispatcher.idle()
  return context
}

describe('A handover from a session that never answered', () => {
  it('takes the steps, the last message and the transcript of the session before it, and names the failed one', async () => {
    const { dispatcher, relays, handoffs } = await running()
    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()
    handoffs['ABC-1'] = empty('session-1')

    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()

    const prompt = relays.at(-1)!.prompt!
    expect(relays.at(-1)).toMatchObject({ sessionId: 'session-1', workdir: worked.workdir })
    expect(prompt).toContain('Edit src/host.test.ts')
    expect(prompt).toContain('Next: make the host test pass.')
    expect(prompt).toContain(worked.transcript)
    expect(prompt).toContain('session-1.jsonl')
    expect(prompt).toContain('Invalid API key')
    expect(prompt).toContain('пользователь')
  })

  it('goes back past two failed sessions in a row to the one that worked', async () => {
    const { dispatcher, relays, handoffs } = await running()
    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()
    handoffs['ABC-1'] = empty('session-1')
    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()
    handoffs['ABC-1'] = empty('session-2', 'Credit balance is too low')

    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()

    const prompt = relays.at(-1)!.prompt!
    expect(relays.at(-1)).toMatchObject({ sessionId: 'session-2' })
    expect(prompt).toContain('Next: make the host test pass.')
    expect(prompt).toContain(worked.transcript)
    expect(prompt).toContain('session-1.jsonl')
    expect(prompt).toContain('session-2.jsonl')
    expect(prompt).toContain('Credit balance is too low')
  })

  it('forgets the old session once a later one answered', async () => {
    const { dispatcher, relays, handoffs } = await running()
    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()
    handoffs['ABC-1'] = { ...worked, sessionId: 'session-1', transcript: 'C:/accounts/john/projects/abc/session-1.jsonl', lastMessage: 'Tests pass.' }

    dispatcher.restart('ABC', 'ABC-1')
    await dispatcher.idle()

    const prompt = relays.at(-1)!.prompt!
    expect(prompt).toContain('Tests pass.')
    expect(prompt).not.toContain('Next: make the host test pass.')
    expect(prompt).not.toContain(worked.transcript)
  })

  it('hands over from the failed session itself when no handover started it', async () => {
    const context = setup({ state: { ...runningState(), active: [{ ...runningState().active[0]!, current: { task: 'ABC-1', sessionId: 'first-session', since: '2026-10-31T09:00:00.000Z' } }] } })
    context.handoffs['ABC-1'] = empty('first-session')
    context.dispatcher.setTasks('ABC', [task('ABC-1')])
    await context.dispatcher.idle()

    context.dispatcher.restart('ABC', 'ABC-1')
    await context.dispatcher.idle()

    const prompt = context.relays.at(-1)!.prompt!
    expect(prompt).toContain('first-session.jsonl')
    expect(prompt).not.toContain(worked.transcript)
  })
})
