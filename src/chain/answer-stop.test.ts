import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState } from './dispatcher.js'
import type { HandoffSession } from './relay.js'
import { Writes } from '../storage/database.js'
import { memoryDatabase } from '../storage/memory.js'
import { Mailbox } from '../sessions/mailbox.js'
import { createChat } from '../sessions/chat.js'
import { settleMail } from '../sessions/mailRelay.js'

const session: HandoffSession = {
  sessionId: 'old-session', agentId: 'old', account: 'global', cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1', branch: 'abc-1/task', transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z', recent: [], lastMessage: 'Ready', checkpoint: null,
}

async function running(options: SetupOptions = {}) {
  const context = setup({
    state: { ...emptyChainState(), active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: session.sessionId, since: '2026-09-26T11:00:00Z' }, paused: false, error: null }] },
    ...options,
  })
  context.handoffs['ABC-1'] = { ...session }
  context.dispatcher.setTasks('ABC', [task('ABC-1')])
  await context.dispatcher.idle()
  return context
}

describe('answers queued before stopAfter removes the chain', { timeout: 30_000 }, () => {
  it('delivers an answer to the same question after the chain stops', async () => {
    const { dispatcher, relays, journal } = await running({ asked: { 'ABC-1': 'question' }, waiting: new Set(['ABC-1']) })
    dispatcher.stopAfter('ABC', true)
    const delivered = dispatcher.answer('ABC', 'ABC-1', session.sessionId, 'question', 'Use blue')
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([])
    expect(relays).toEqual([{ kind: 'reply', task: 'ABC-1', sessionId: session.sessionId, prompt: 'Use blue' }])
    expect(await delivered).toBe(true)
    expect(journal.at(-1)).toMatchObject({ reason: 'answer', previous: session.sessionId })
  })

  it('logs and refuses an answer when a different session took over before delivery', async () => {
    const { dispatcher, handoffs, relays, log } = await running()
    dispatcher.stopAfter('ABC', true)
    const delivered = dispatcher.answer('ABC', 'ABC-1', session.sessionId, null, 'Use blue')
    handoffs['ABC-1'] = { ...session, sessionId: 'new-session' }
    await dispatcher.idle()
    expect(relays).toEqual([])
    expect(await delivered).toBe(false)
    expect(log.join('\n')).toContain(`the answer did not reach the session ${session.sessionId}`)
  })

  it('returns mailbox messages when transport fails, with or without a chain', async () => {
    for (const stop of [false, true]) {
      const { dispatcher, clock, log } = await running({ reply: async () => { throw new Error('resume failed') } })
      const writes = new Writes(() => {})
      const mailbox = await Mailbox.open(await memoryDatabase(), writes, () => clock.now)
      onTestFinished(() => writes.settled())
      const { mailRelay } = createChat({
        dispatcher, mailbox, configuredProject: () => 'ABC',
        liveView: () => ({ sessionId: session.sessionId, asking: false, ask: null }),
        midTurn: () => false, steering: () => false, steer: async () => false,
        language: () => 'en', changed: () => {}, log: (line) => log.push(line), now: () => clock.now,
      })
      mailbox.post('ABC-1', session.sessionId, 'Use blue', [])
      clock.now = new Date(clock.now.getTime() + 11_000)
      if (stop) dispatcher.stopAfter('ABC', true)
      settleMail(mailRelay)
      await dispatcher.idle()
      await vi.waitFor(() => expect(mailbox.of(session.sessionId).map((mail) => mail.fate)).toEqual(['returned']))
      expect(log.join('\n')).toContain('resume failed')
    }
  })

  it('resumes with mailbox messages from the finished turn and leaves the chain stopped', async () => {
    const { dispatcher, busy, clock, relays, launched } = await running({ busy: new Set(['ABC-1']) })
    const writes = new Writes(() => {})
    const mailbox = await Mailbox.open(await memoryDatabase(), writes, () => clock.now)
    onTestFinished(() => writes.settled())
    const { mailRelay } = createChat({
      dispatcher, mailbox, configuredProject: () => 'ABC',
      liveView: () => ({ sessionId: session.sessionId, asking: false, ask: null }),
      midTurn: () => busy.has('ABC-1'), steering: () => false, steer: async () => false,
      language: () => 'en', changed: () => {}, log: () => {}, now: () => clock.now,
    })
    mailbox.post('ABC-1', session.sessionId, 'Use the other parser', [])
    dispatcher.stopAfter('ABC', true)
    busy.clear()
    clock.now = new Date(clock.now.getTime() + 11_000)
    const settled = settleMail(mailRelay)
    await dispatcher.idle()
    await settled
    expect(dispatcher.state.active).toEqual([])
    expect(launched).toEqual([])
    expect(relays).toHaveLength(1)
    expect(relays[0]).toMatchObject({ kind: 'reply', sessionId: session.sessionId })
    expect(relays[0]?.prompt).toContain('Use the other parser')
    await vi.waitFor(() => expect(mailbox.of(session.sessionId).map((mail) => [mail.fate, mail.event])).toEqual([['delivered', 'resume']]))
  })
})
