import { describe, expect, it, onTestFinished } from 'vitest'
import { setup, task } from './dispatcher.fixture.js'
import { emptyChainState } from './dispatcher.js'
import type { HandoffSession } from './relay.js'
import { Writes } from '../storage/database.js'
import { memoryDatabase } from '../storage/memory.js'
import { Mailbox } from '../sessions/mailbox.js'
import { createChat, localChat } from '../sessions/chat.js'

const session: HandoffSession = {
  sessionId: 'old-session', agentId: 'old', account: 'global', cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1', branch: 'abc-1/task', transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z', recent: [], lastMessage: 'Ready', checkpoint: null,
}

/** ABC-1's session works; its inbox takes a message when `inbox` says so. */
async function working(inbox: boolean) {
  const context = setup({
    state: { ...emptyChainState(), active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: session.sessionId, since: '2026-09-26T11:00:00Z' }, paused: false, error: null }] },
    busy: new Set(['ABC-1']),
  })
  context.handoffs['ABC-1'] = { ...session }
  context.dispatcher.setTasks('ABC', [task('ABC-1')])
  await context.dispatcher.idle()
  const writes = new Writes(() => {})
  const mailbox = await Mailbox.open(await memoryDatabase(), writes, () => context.clock.now)
  onTestFinished(() => writes.settled())
  const told: { task: string; sessionId: string; text: string }[] = []
  const chat = createChat({
    dispatcher: context.dispatcher, mailbox, configuredProject: () => 'ABC',
    liveView: () => ({ sessionId: session.sessionId, asking: false, ask: null }),
    midTurn: () => true, steering: () => false, steer: async () => false,
    chat: localChat(mailbox, async () => false, async (task, sessionId, text) => (told.push({ task, sessionId, text }), inbox)),
    language: () => 'en', changed: () => {}, log: (line) => context.log.push(line), now: () => context.clock.now,
  })
  mailbox.take(session.sessionId)
  return { ...context, mailbox, told, ...chat }
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
