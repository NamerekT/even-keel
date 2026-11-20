import { describe, expect, it, vi } from 'vitest'
import { CLAUDE } from '../claude/name.js'
import { replyPrompt } from '../sessions/ask.js'
import { ResumeHolds } from '../sessions/holds.js'
import { wireAgentStatus } from './accounts.js'
import { wireMachineChats, type MachineChatsContext } from './machine-chats.js'

const chat = 'chat-123456abcdef'
const session = { sessionId: 'session-1', account: 'global', cwd: '/project' }
const home = { key: session.account, agent: CLAUDE }
const start = { prompt: 'Continue', model: null, effort: null }

function setup(status: 'idle' | 'busy', question?: string, hung = false) {
  const holds = new ResumeHolds()
  const monitor = { holds, handoff: () => session }
  const liveView = () => ({ sessionId: session.sessionId, ask: question ? { id: question } : null, hungSince: hung ? '2026-11-20T10:00:00Z' : null })
  const agents = [{ sessionId: session.sessionId, status }]
  const agentStatus = wireAgentStatus({ agents, liveView, monitor } as unknown as Parameters<typeof wireAgentStatus>[0])
  const reply = vi.fn<() => Promise<string | null>>().mockResolvedValue(null)
  const toldInbox = vi.fn<() => Promise<boolean>>().mockResolvedValue(false)
  const heard = new Set<string>()
  const mailbox = { listens: (sessionId: string) => heard.has(sessionId), post: vi.fn(), listen: (sessionId: string) => heard.add(sessionId) }
  const stopIn = vi.fn()
  const resumeIn = vi.fn().mockResolvedValue(session.sessionId)
  const chats = wireMachineChats({
    monitor, liveView, agentStatus, stopIn, resumeIn, toldInbox, mailbox,
    homeOf: () => home, agentOf: () => ({ reply }), daemons: { prepare: vi.fn() },
    configStore: { current: { settings: {} } }, branchOf: () => 'dev',
  } as unknown as MachineChatsContext)
  return { send: (prompt = start.prompt) => chats.send('project', chat, { ...start, prompt }), holds, reply, toldInbox, mailbox, stopIn, resumeIn }
}

describe('a message to an existing project chat', () => {
  it('stops and resumes an idle Claude --bg session with the message', async () => {
    const { send, stopIn, resumeIn, holds } = setup('idle')
    await expect(send()).resolves.toBe(session.sessionId)
    expect(stopIn).toHaveBeenCalledWith(home, session)
    expect(resumeIn).toHaveBeenCalledWith(home, session, expect.objectContaining({ prompt: start.prompt }))
    expect(holds.held(session.sessionId)).toBe(true)
  })

  it('logs and refuses a message to a busy --bg session before stopping it', async () => {
    using log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { send, stopIn, resumeIn } = setup('busy')
    await expect(send()).rejects.toMatchObject({ notice: { code: 'chats.busy' } })
    expect(stopIn).not.toHaveBeenCalled()
    expect(resumeIn).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining(chat))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('chats.busy'))
  })

  it('refuses another message while the monitor still shows the question just answered', async () => {
    const { send, stopIn, resumeIn, holds } = setup('idle', 'question-1')
    await send()
    await expect(send()).rejects.toMatchObject({ notice: { code: 'chats.busy' } })
    expect(stopIn).toHaveBeenCalledTimes(1)
    expect(resumeIn).toHaveBeenCalledTimes(1)
    expect(holds.turning(session.sessionId, 'question-1')).toBe(true)
  })

  it('lets a live adapter take the message during a turn', async () => {
    const { send, reply, stopIn, resumeIn } = setup('busy')
    reply.mockResolvedValue(session.sessionId)
    await expect(send()).resolves.toBe(session.sessionId)
    expect(stopIn).not.toHaveBeenCalled()
    expect(resumeIn).not.toHaveBeenCalled()
  })

  it.each(['busy', 'idle'] as const)('writes the message into the inbox of a %s --bg session, never cutting the turn', async (status) => {
    const { send, toldInbox, stopIn, resumeIn } = setup(status)
    toldInbox.mockResolvedValue(true)
    await expect(send()).resolves.toBe(session.sessionId)
    expect(toldInbox).toHaveBeenCalledWith(chat, session, start.prompt)
    expect(stopIn).not.toHaveBeenCalled()
    expect(resumeIn).not.toHaveBeenCalled()
  })

  it('puts the message mid-turn into the mailbox when the inbox is unknown and the hooks ask for mail', async () => {
    const { send, mailbox, stopIn, resumeIn } = setup('busy')
    mailbox.listen(session.sessionId)
    const prompt = replyPrompt({ from: 'page', answers: {}, text: 'Look at this', files: ['/project/.temp/inbox/a.png'] }, null, 'en')
    await expect(send(prompt)).resolves.toBe(session.sessionId)
    expect(mailbox.post).toHaveBeenCalledWith(chat, session.sessionId, 'Look at this', ['/project/.temp/inbox/a.png'])
    expect(stopIn).not.toHaveBeenCalled()
    expect(resumeIn).not.toHaveBeenCalled()
  })

  it('refuses mid-turn when the session neither has an inbox nor hooks that ask for mail', async () => {
    using _ = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { send, mailbox } = setup('busy')
    await expect(send()).rejects.toMatchObject({ notice: { code: 'chats.busy' } })
    expect(mailbox.post).not.toHaveBeenCalled()
  })

  it('tries neither the agent nor the inbox of a hung session', async () => {
    const { send, reply, toldInbox, stopIn, resumeIn } = setup('idle', undefined, true)
    await expect(send()).resolves.toBe(session.sessionId)
    expect(reply).not.toHaveBeenCalled()
    expect(toldInbox).not.toHaveBeenCalled()
    expect(stopIn).toHaveBeenCalled()
    expect(resumeIn).toHaveBeenCalled()
  })
})
