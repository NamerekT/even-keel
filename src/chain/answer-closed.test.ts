import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { done, setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState } from './dispatcher.js'
import { fakeMain } from './maincheck.fixture.js'
import type { HandoffSession } from './relay.js'
import { Writes } from '../storage/database.js'
import { memoryDatabase } from '../storage/memory.js'
import { Mailbox } from '../sessions/mailbox.js'
import { createChat } from '../sessions/chat.js'
import { mailFor, settleMail } from '../sessions/mailRelay.js'

const session: HandoffSession = {
  sessionId: 'old-session', agentId: 'old', account: 'global', cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1', branch: 'abc-1/task', transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z', recent: [], lastMessage: 'Ready', checkpoint: null,
}

/** ABC-1 is the current task of a running chain, its session mid-turn; `merged` — its branch is in main already. */
async function running(merged: boolean, options: SetupOptions = {}) {
  const { ci, deps } = fakeMain()
  if (merged) ci.merged.add('ABC-1')
  const busy = options.busy ?? new Set(['ABC-1'])
  const context = setup({
    state: { ...emptyChainState(), active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: session.sessionId, since: '2026-09-26T11:00:00Z' }, paused: false, error: null }] },
    main: deps,
    busy,
    ...options,
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
  // The session's hooks have asked for mail once, so a message mid-turn goes into the mailbox.
  mailbox.take(session.sessionId)
  return { ...context, ci, busy, mailbox, ...chat }
}

const reply = (text: string) => ({ from: 'page' as const, answers: {}, text, files: [] })

describe('a message to the session of a task that is over for the chain (BTN-558)', { timeout: 30_000 }, () => {
  it('counts a task closed once its branch is in main or the tracker has it in Done', async () => {
    const open = await running(false)
    expect(await open.dispatcher.closed('ABC', 'ABC-1')).toBe(false)
    const merged = await running(true)
    expect(await merged.dispatcher.closed('ABC', 'ABC-1')).toBe(true)
    const finished = await running(false)
    finished.dispatcher.setTasks('ABC', [task('ABC-1', done)])
    expect(await finished.dispatcher.closed('ABC', 'ABC-1')).toBe(true)
  })

  it('refuses the chat message at once, with nothing posted', async () => {
    const { answerSession, mailbox } = await running(true)
    await expect(answerSession('ABC', 'ABC-1', session.sessionId, null, reply('Smaller font, please'))).rejects.toMatchObject({
      notice: { code: 'answer.closed', params: { task: 'ABC-1' } },
    })
    expect(mailbox.of(session.sessionId)).toEqual([])
  })

  it('posts the message of an open task as before', async () => {
    const { answerSession, mailbox } = await running(false)
    await answerSession('ABC', 'ABC-1', session.sessionId, null, reply('Smaller font, please'))
    expect(mailbox.waiting().map((mail) => mail.text)).toEqual(['Smaller font, please'])
  })

  it('refuses a message to an idle session too, without resuming it', async () => {
    const { answerSession, relays } = await running(true, { busy: new Set() })
    await expect(answerSession('ABC', 'ABC-1', session.sessionId, null, reply('One more thing'))).rejects.toMatchObject({ notice: { code: 'answer.closed' } })
    expect(relays).toEqual([])
  })

  it('gives the hook nothing for a message posted before the merge and returns it to the chat as closed', async () => {
    const { mailRelay, mailbox, ci } = await running(false)
    mailbox.post('ABC-1', session.sessionId, 'Smaller font, please', [])
    ci.merged.add('ABC-1')
    expect(await mailFor(mailRelay, session.sessionId, 'PreToolUse')).toBeNull()
    expect(mailbox.of(session.sessionId).map((mail) => [mail.fate, mail.reason])).toEqual([['returned', 'closed']])
  })

  it('does not resume a session that ended its turn after the merge with a message waiting', async () => {
    const { mailRelay, mailbox, ci, clock, busy, relays } = await running(false)
    mailbox.post('ABC-1', session.sessionId, 'Smaller font, please', [])
    ci.merged.add('ABC-1')
    busy.clear()
    clock.now = new Date(clock.now.getTime() + 11_000)
    await settleMail(mailRelay)
    await vi.waitFor(() => expect(mailbox.of(session.sessionId).map((mail) => [mail.fate, mail.reason])).toEqual([['returned', 'closed']]))
    expect(relays).toEqual([])
  })
})
