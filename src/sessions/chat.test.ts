import { describe, expect, it, vi } from 'vitest'
import { createChat } from './chat.js'
import type { Mailbox } from './mailbox.js'

const chat = 'chat-123456abcdef'

function setup() {
  const dispatcher = { answerable: vi.fn(), answer: vi.fn().mockResolvedValue(true), renew: vi.fn(), closed: vi.fn().mockResolvedValue(true) }
  const resumeChat = vi.fn().mockResolvedValue(true)
  const { mailRelay } = createChat({
    dispatcher,
    mailbox: {} as Mailbox,
    configuredProject: (task) => (task === 'ABC-1' ? 'project' : undefined),
    liveView: () => undefined,
    midTurn: () => false,
    steering: () => false,
    steer: async () => false,
    resumeChat,
    language: () => 'en',
    changed: () => {},
    log: () => {},
    now: () => new Date(),
  })
  return { mailRelay, dispatcher, resumeChat }
}

describe("the mailbox's relay of a project chat (BTN-1346)", () => {
  it("resumes a chat's session through the chats, never the chain", async () => {
    const { mailRelay, dispatcher, resumeChat } = setup()
    await expect(mailRelay.resume(chat, 'session-1', 'And the tests?')).resolves.toBe(true)
    expect(resumeChat).toHaveBeenCalledWith(chat, 'session-1', 'And the tests?')
    expect(dispatcher.answer).not.toHaveBeenCalled()
  })

  it('never takes a chat for a closed task', async () => {
    const { mailRelay, dispatcher } = setup()
    await expect(mailRelay.closed(chat)).resolves.toBe(false)
    expect(dispatcher.closed).not.toHaveBeenCalled()
    await expect(mailRelay.closed('ABC-1')).resolves.toBe(true)
  })

  it("resumes a task's session through the chain as before", async () => {
    const { mailRelay, dispatcher, resumeChat } = setup()
    await mailRelay.resume('ABC-1', 'session-2', 'Go on')
    expect(dispatcher.answer).toHaveBeenCalledWith('project', 'ABC-1', 'session-2', null, 'Go on')
    expect(resumeChat).not.toHaveBeenCalled()
  })
})
