import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CLAUDE } from '../claude/name.js'
import { replyPrompt } from '../sessions/ask.js'
import { ChatSessions } from '../sessions/chat-sessions.js'
import { ResumeHolds } from '../sessions/holds.js'
import { wireAgentStatus } from './accounts.js'
import { transcriptPartOf, wireMachineChats, type MachineChatsContext } from './machine-chats.js'

const chat = 'chat-123456abcdef'
const session = { sessionId: 'session-1', account: 'global', cwd: '/project' }
const home = { key: session.account, agent: CLAUDE }
const start = { prompt: 'Continue', model: null, effort: null }

const bridge = { package: 'agent-bridge@even-keel', dir: '/cache/agent-bridge', name: 'agent-bridge', marketplace: 'ek-1', marketplaceFile: '/cache/m.json', servers: ['memory'] }
const huly = { ...bridge, package: 'huly@even-keel', dir: '/cache/huly', name: 'huly', servers: ['huly'] }
const set = {
  plugins: [bridge, huly],
  mcp: [{ name: 'huly', plugin: 'huly', url: 'http://127.0.0.1:4748/mcp/project/huly@even-keel@b/huly' }],
}
const CHAT_SETTINGS = '{"promptCacheTtl":"1h","enabledPlugins":{"own@market":false}}'

function setup(status: 'idle' | 'busy', question?: string, hung = false, agent = CLAUDE, config: Record<string, unknown> = {}) {
  const holds = new ResumeHolds()
  const monitor = { holds, handoff: () => session }
  const liveView = () => ({ sessionId: session.sessionId, ask: question ? { id: question } : null, hungSince: hung ? '2026-11-20T10:00:00Z' : null })
  const agents = [{ sessionId: session.sessionId, status }]
  const agentStatus = wireAgentStatus({ agents, liveView, monitor } as unknown as Parameters<typeof wireAgentStatus>[0])
  const reply = vi.fn<() => Promise<string | null>>().mockResolvedValue(null)
  const toldInbox = vi.fn<() => Promise<boolean>>().mockResolvedValue(false)
  const approved = vi.fn<() => boolean>().mockReturnValue(false)
  const heard = new Set<string>()
  const mailbox = { listens: (sessionId: string) => heard.has(sessionId), post: vi.fn(), listen: (sessionId: string) => heard.add(sessionId) }
  const stopIn = vi.fn()
  const resumeIn = vi.fn().mockResolvedValue(session.sessionId)
  const launchIn = vi.fn().mockResolvedValue(session.sessionId)
  const chatStartOf = vi.fn((_project: string, _agent: string, _own: Record<string, boolean>) => set)
  const chatSettingsFor = vi.fn((_project: string, _folder: string, _own: Record<string, boolean>) => CHAT_SETTINGS)
  const chatSessions = new ChatSessions()
  const chats = wireMachineChats({
    monitor, liveView, agentStatus, stopIn, resumeIn, launchIn, toldInbox, approved, mailbox, chatSessions,
    homeOf: () => ({ ...home, agent }), agentOf: () => ({ reply }), daemons: { prepare: vi.fn() },
    configStore: { current: { settings: {}, execution: {}, projects: {}, ...config } }, branchOf: () => 'dev',
    packages: { chatStartOf }, chatSettingsFor,
  } as unknown as MachineChatsContext)
  return {
    send: (prompt = start.prompt) => chats.send('project', chat, { ...start, prompt }),
    launch: () => chats.launch('project', '/project', chat, { ...start, account: session.account }),
    chats, holds, reply, toldInbox, approved, mailbox, stopIn, resumeIn, launchIn, chatStartOf, chatSettingsFor, chatSessions,
  }
}

// BTN-1772: under `-n` the CLI generates no title, so a Claude chat goes without one and the machine binds its sessions.
describe("a project chat's sessions", () => {
  it('start a Claude chat for the CLI to title, other agents as before', async () => {
    const claude = setup('idle')
    await claude.launch()
    expect(claude.launchIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: chat, autoTitle: true }), 'project')
    const codex = setup('idle', undefined, false, 'codex')
    await codex.launch()
    expect(codex.launchIn.mock.calls[0]![1]).not.toHaveProperty('autoTitle')
  })

  it('are bound to the chat at the launch and at a resume into a copy', async () => {
    const { launch, send, launchIn, resumeIn, chatSessions } = setup('idle')
    launchIn.mockResolvedValue('first')
    resumeIn.mockResolvedValue('copy')
    await launch()
    await send()
    expect(['first', 'copy'].map((id) => chatSessions.chatOf(id))).toEqual([chat, chat])
  })
})

describe('a message to an existing project chat', () => {
  it('decides the call the session waits to have approved, with no reply, stop or resume (BTN-1769)', async () => {
    const { send, approved, reply, toldInbox, stopIn, resumeIn } = setup('idle')
    approved.mockReturnValue(true)
    await expect(send('Allow')).resolves.toBe(session.sessionId)
    expect(approved).toHaveBeenCalledWith(chat, session, 'Allow')
    expect(reply).not.toHaveBeenCalled()
    expect(toldInbox).not.toHaveBeenCalled()
    expect(stopIn).not.toHaveBeenCalled()
    expect(resumeIn).not.toHaveBeenCalled()
  })

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

  it.each(['codex', 'copilot', 'opencode'])('puts a message mid-turn of a %s session whose hooks ask into the mailbox, not a refusal (BTN-1346)', async (agent) => {
    using _ = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { send, mailbox, stopIn, resumeIn } = setup('busy', undefined, false, agent)
    mailbox.listen(session.sessionId)
    await expect(send()).resolves.toBe(session.sessionId)
    expect(mailbox.post).toHaveBeenCalledWith(chat, session.sessionId, start.prompt, [])
    expect(stopIn).not.toHaveBeenCalled()
    expect(resumeIn).not.toHaveBeenCalled()
  })

  it.each([CLAUDE, 'codex', 'copilot', 'opencode'])("starts and resumes a %s chat with the project's packages behind the gateway, as a chain session (BTN-1694)", async (agent) => {
    const { launch, send, launchIn, resumeIn, chatStartOf } = setup('idle', undefined, false, agent)
    await launch()
    await send()
    const packages = expect.objectContaining(set)
    expect(launchIn).toHaveBeenCalledWith(expect.anything(), packages, 'project')
    expect(resumeIn).toHaveBeenCalledWith(expect.anything(), session, packages)
    expect(chatStartOf).toHaveBeenCalledTimes(2)
    expect(chatStartOf).toHaveBeenCalledWith('project', agent, {})
    expect(launchIn.mock.calls[0]![1]).not.toHaveProperty('ownPlugins')
  })

  it("starts and resumes a chat with its own choice of packages over the project's (BTN-1696)", async () => {
    const own = { 'huly@even-keel': false, 'lint@example': true }
    const { chats, chatStartOf, chatSettingsFor } = setup('idle')
    await chats.launch('project', '/project', chat, { ...start, account: session.account, packages: own })
    await chats.send('project', chat, { ...start, packages: own })
    expect(chatStartOf.mock.calls).toEqual([['project', CLAUDE, own], ['project', CLAUDE, own]])
    expect(chatSettingsFor.mock.calls).toEqual([['project', '/project', own], ['project', '/project', own]])
  })

  it("starts and resumes a Claude chat with the chat's settings of its folder (BTN-1401, BTN-1694)", async () => {
    const { launch, send, launchIn, resumeIn, chatSettingsFor } = setup('idle')
    await launch()
    await send()
    const settings = expect.objectContaining({ settings: CHAT_SETTINGS })
    expect(launchIn).toHaveBeenCalledWith(expect.anything(), settings, 'project')
    expect(resumeIn).toHaveBeenCalledWith(expect.anything(), session, settings)
    expect(chatSettingsFor).toHaveBeenCalledWith('project', '/project', {})
  })

  it.each(['codex', 'copilot', 'opencode'])('gives a %s chat no Claude settings', async (agent) => {
    const { launch, launchIn, chatSettingsFor } = setup('idle', undefined, false, agent)
    await launch()
    expect(launchIn.mock.calls[0]![1]).not.toHaveProperty('settings')
    expect(chatSettingsFor).not.toHaveBeenCalled()
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

describe('a part of a chat transcript carried to another machine (BTN-1711)', () => {
  it('reads the bytes asked for, never past the end, with the file name and whole size', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ek-transcript-'))
    try {
      const path = join(dir, 'session-1.jsonl')
      writeFileSync(path, '0123456789')
      expect(await transcriptPartOf(path, 0, 0)).toEqual({ name: 'session-1.jsonl', size: 10, data: '' })
      const part = await transcriptPartOf(path, 6, 100)
      expect(Buffer.from(part!.data, 'base64').toString()).toBe('6789')
      expect(await transcriptPartOf(join(dir, 'gone.jsonl'), 0, 10)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// BTN-1796: a session long stopped is no longer listed after the machine's restart, but its file is still there.
describe("a chat's session the monitor no longer lists", () => {
  function unlisted(path: string) {
    const feed = Array.from({ length: 40 }, (_, at) => ({ kind: 'text', text: `line ${at}` }))
    const homes = [{ key: 'other', agent: CLAUDE }, home]
    const agentOf = () => ({
      record: async (at: { key: string }, sessionId: string) => (at.key === home.key && sessionId === session.sessionId ? { sessionId, feed } : undefined),
      feedFile: async (at: { key: string }, sessionId: string) => (at.key === home.key && sessionId === session.sessionId ? path : undefined),
    })
    const inHomes = async <T>(read: (at: typeof home) => Promise<T | undefined>) => {
      for (const at of homes) {
        const found = await read(at)
        if (found !== undefined) return found
      }
      return undefined
    }
    return wireMachineChats({ monitor: { handoff: () => undefined }, agentOf, inHomes } as unknown as MachineChatsContext)
  }

  it("finds its transcript by the session id in the machine's account folders", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ek-transcript-'))
    try {
      const path = join(dir, 'session-1.jsonl')
      writeFileSync(path, '0123456789')
      const chats = unlisted(path)
      expect(await chats.transcriptPart(chat, 0, 0, session.sessionId)).toEqual({ name: 'session-1.jsonl', size: 10, data: '' })
      const past = await chats.past(chat, session.sessionId)
      expect(past).toMatchObject({ sessionId: session.sessionId, transcript: path })
      expect(past!.recent.map((line) => line.text)).toEqual(Array.from({ length: 30 }, (_, at) => `line ${at + 10}`))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('knows none without the session id, or of an id no folder holds', async () => {
    const chats = unlisted('/gone.jsonl')
    expect(await chats.past(chat)).toBeNull()
    expect(await chats.transcriptPart(chat, 0, 0)).toBeNull()
    expect(await chats.past(chat, 'session-2')).toBeNull()
    expect(await chats.transcriptPart(chat, 0, 0, 'session-2')).toBeNull()
  })
})
