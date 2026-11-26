import { describe, expect, it } from 'vitest'
import { setup, task } from './dispatcher.fixture.js'
import { emptyChainState } from './dispatcher.js'
import type { HandoffSession } from './relay.js'
import { memoryMailbox } from '../sessions/mailbox.fixture.js'
import { createChat, elsewhereChat, localChat } from '../sessions/chat.js'

const session: HandoffSession = {
  sessionId: 'old-session', agentId: 'old', account: 'global', cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1', branch: 'abc-1/task', transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z', recent: [], lastMessage: 'Ready', checkpoint: null,
}

/** ABC-1's session works, `elsewhere` on a machine elsewhere; its inbox takes a message when `inbox` says so. */
async function working(inbox: boolean, elsewhere = false) {
  const context = setup({
    state: { ...emptyChainState(), active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: session.sessionId, since: '2026-09-26T11:00:00Z' }, paused: false, error: null }] },
    busy: new Set(['ABC-1']),
  })
  context.handoffs['ABC-1'] = { ...session }
  context.dispatcher.setTasks('ABC', [task('ABC-1')])
  await context.dispatcher.idle()
  const mailbox = memoryMailbox(() => context.clock.now)
  const told: { task: string; sessionId: string; text: string }[] = []
  const toldHere: string[] = []
  const tell = async (task: string, sessionId: string, text: string) => (told.push({ task, sessionId, text }), inbox)
  const there = memoryMailbox(() => context.clock.now)
  const own = localChat(mailbox, async () => false, elsewhere ? async (_task, _sessionId, text) => (toldHere.push(text), true) : tell)
  const chat = createChat({
    dispatcher: context.dispatcher, mailbox, configuredProject: () => 'ABC',
    liveView: () => ({ sessionId: session.sessionId, asking: false, ask: null }),
    midTurn: () => true, steering: () => false, steer: async () => false,
    chat: own,
    ...(elsewhere && { chatOf: () => elsewhereChat(own, localChat(there, async () => false, tell)) }),
    language: () => 'en', changed: () => {}, log: (line) => context.log.push(line), now: () => context.clock.now,
  })
  mailbox.take(session.sessionId)
  return { ...context, mailbox, there, told, toldHere, ...chat }
}

const reply = (text: string) => ({ from: 'page' as const, answers: {}, text, files: [] })

describe('a chat message to a working session with an inbox socket (BTN-1322)', () => {
  it('goes into the inbox at once, with nothing left for the hooks and no resume', async () => {
    const { answerSession, dispatcher, relays, mailbox, told } = await working(true)
    await answerSession('ABC', 'ABC-1', session.sessionId, null, reply('Smaller font, please'))
    await dispatcher.idle()
    expect(told).toEqual([{ task: 'ABC-1', sessionId: session.sessionId, text: 'Smaller font, please' }])
    expect(mailbox.waiting()).toEqual([])
    expect(relays).toEqual([])
  })

  it('waits for the hooks when the inbox does not take it', async () => {
    const { answerSession, dispatcher, relays, mailbox } = await working(false)
    await answerSession('ABC', 'ABC-1', session.sessionId, null, reply('Smaller font, please'))
    await dispatcher.idle()
    expect(mailbox.waiting().map((mail) => mail.text)).toEqual(['Smaller font, please'])
    expect(relays).toEqual([])
  })
})

describe('a chat message to a working session elsewhere (BTN-1633)', () => {
  it("goes into the inbox on the session's machine, never the own machine's", async () => {
    const { answerSession, dispatcher, relays, mailbox, told, toldHere } = await working(true, true)
    await answerSession('ABC', 'ABC-1', session.sessionId, null, reply('Smaller font, please'))
    await dispatcher.idle()
    expect(told).toEqual([{ task: 'ABC-1', sessionId: session.sessionId, text: 'Smaller font, please' }])
    expect(toldHere).toEqual([])
    expect(mailbox.waiting()).toEqual([])
    expect(relays).toEqual([])
  })

  it("waits in the hub's mailbox, which its hooks ask, when its inbox does not take it", async () => {
    const { answerSession, dispatcher, mailbox, there } = await working(false, true)
    await answerSession('ABC', 'ABC-1', session.sessionId, null, reply('Smaller font, please'))
    await dispatcher.idle()
    expect(mailbox.waiting().map((mail) => mail.text)).toEqual(['Smaller font, please'])
    expect(there.waiting()).toEqual([])
  })
})
