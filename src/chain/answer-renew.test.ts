import { describe, expect, it, onTestFinished } from 'vitest'
import { setup, task } from './dispatcher.fixture.js'
import { emptyChainState } from './dispatcher.js'
import type { HandoffSession } from './relay.js'
import { Writes } from '../storage/database.js'
import { memoryDatabase } from '../storage/memory.js'
import { Mailbox } from '../sessions/mailbox.js'
import { createChat } from '../sessions/chat.js'

const session: HandoffSession = {
  sessionId: 'old-session', agentId: 'old', account: 'global', cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1', branch: 'abc-1/task', transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z', recent: [], lastMessage: 'Ready', checkpoint: null,
}

async function running(busy: Set<string>) {
  const context = setup({
    state: { ...emptyChainState(), active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: session.sessionId, since: '2026-09-26T11:00:00Z' }, paused: false, error: null }] },
    busy,
  })
  context.handoffs['ABC-1'] = { ...session }
  context.dispatcher.setTasks('ABC', [task('ABC-1')])
  await context.dispatcher.idle()
  const writes = new Writes(() => {})
  const mailbox = await Mailbox.open(await memoryDatabase(), writes, () => context.clock.now)
  onTestFinished(() => writes.settled())
  const chat = createChat({
    dispatcher: context.dispatcher, mailbox, configuredProject: () => 'ABC',
    liveView: () => ({ sessionId: session.sessionId, asking: false, ask: null }),
    midTurn: () => busy.has('ABC-1'), steering: () => false, steer: async () => true,
    language: () => 'en', changed: () => {}, log: (line) => context.log.push(line), now: () => context.clock.now,
  })
  mailbox.take(session.sessionId)
  return { ...context, mailbox, ...chat }
}

const reply = (text: string) => ({ from: 'page' as const, answers: {}, text, files: [] })

describe('a chat message sent as a new session (BTN-757)', () => {
  it('hands the task to a new session with the message instead of resuming the waiting one', async () => {
    const { answerSession, dispatcher, relays, journal } = await running(new Set())
    await answerSession('ABC', 'ABC-1', session.sessionId, null, reply('Smaller font, please'), true)
    await dispatcher.idle()
    expect(relays).toMatchObject([{ kind: 'relay', sessionId: session.sessionId, reason: 'message' }])
    expect(relays[0]?.prompt).toMatch(/Сообщение пользователя:\n\nSmaller font, please\n$/)
    expect(journal.at(-1)).toMatchObject({ reason: 'restart', cause: 'message', previous: session.sessionId })
  })

  it('leaves a message to a working session to its mailbox', async () => {
    const { answerSession, dispatcher, relays, mailbox } = await running(new Set(['ABC-1']))
    await answerSession('ABC', 'ABC-1', session.sessionId, null, reply('Smaller font, please'), true)
    await dispatcher.idle()
    expect(relays).toEqual([])
    expect(mailbox.waiting().map((mail) => mail.text)).toEqual(['Smaller font, please'])
  })
})
