import { describe, expect, it, vi } from 'vitest'
import { CLAUDE } from '../claude/name.js'
import { ResumeHolds } from '../sessions/holds.js'
import { wireAgentStatus } from './accounts.js'
import { wireMachineChats, type MachineChatsContext } from './machine-chats.js'

const chat = 'chat-123456abcdef'
const session = { sessionId: 'session-1', account: 'global', cwd: '/project' }
const home = { key: session.account, agent: CLAUDE }
const start = { prompt: 'Continue', model: null, effort: null }

function setup(status: 'idle' | 'busy', question?: string) {
  const holds = new ResumeHolds()
  const monitor = { holds, handoff: () => session }
  const liveView = () => ({ sessionId: session.sessionId, ask: question ? { id: question } : null })
  const agents = [{ sessionId: session.sessionId, status }]
  const agentStatus = wireAgentStatus({ agents, liveView, monitor } as unknown as Parameters<typeof wireAgentStatus>[0])
  const reply = vi.fn<() => Promise<string | null>>().mockResolvedValue(null)
  const stopIn = vi.fn()
  const resumeIn = vi.fn().mockResolvedValue(session.sessionId)
  const chats = wireMachineChats({
    monitor, liveView, agentStatus, stopIn, resumeIn,
    homeOf: () => home, agentOf: () => ({ reply }), daemons: { prepare: vi.fn() },
    configStore: { current: { settings: {} } }, branchOf: () => 'dev',
  } as unknown as MachineChatsContext)
  return { send: () => chats.send('project', chat, start), holds, reply, stopIn, resumeIn }
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
})
