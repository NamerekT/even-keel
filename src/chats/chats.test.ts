import { describe, expect, it } from 'vitest'
import type { ChatStart, MachineServices } from '../machine/services.js'
import { fail } from '../notice/notice.js'
import { ABC } from '../storage/database.fixture.js'
import { openDatabase, Writes } from '../storage/database.js'
import type { SessionView } from '../state.js'
import { ProjectChats, type ProjectChatsDeps } from './chats.js'
import { ARCHIVE_AFTER_MS } from './model.js'
import { ChatStore } from './store.js'

const OWN = 'machine-own'

const view = (task: string, sessionId: string, fields: Partial<SessionView> = {}): SessionView => ({
  task,
  sessionId,
  agent: 'claude',
  model: 'claude-opus-5-5',
  effort: null,
  cwd: 'C:\\repos\\example-project',
  branch: 'main',
  lamp: 'waiting',
  checkpoint: false,
  waitingFor: null,
  startupDialog: null,
  hungSince: null,
  asking: false,
  ask: null,
  apiError: null,
  apiErrorKind: null,
  startedAt: '2026-11-18T10:00:00.000Z',
  lastActivityAt: '2026-11-18T10:00:30.000Z',
  contextTokens: 1_000,
  contextWindow: 200_000,
  cache: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  stage: null,
  action: null,
  feed: [],
  remoteUrl: null,
  remoteOff: null,
  account: 'john.doe@example.com',
  ...fields,
})

async function setup(options: { offline?: boolean; stopFails?: boolean } = {}) {
  const db = await openDatabase(undefined)
  const writes = new Writes((line) => { throw new Error(line) })
  const store = await ChatStore.open({ db, writes })
  let clock = new Date('2026-11-18T10:00:00.000Z')
  let ids = 0
  const calls: Array<[string, ...unknown[]]> = []
  const sessions: SessionView[] = []
  const titles = new Map<string, string>()
  const services: Pick<MachineServices, 'chat' | 'chats'> = {
    chat: {
      post: async () => {},
      dismiss: async () => {},
      steer: async () => false,
      saveInbox: async (_project, folder, files) => files.map((file) => `${folder}\\.temp\\inbox\\${file.name}`),
    },
    chats: {
      launch: async (project: string, folder: string, chat: string, start: ChatStart) => {
        calls.push(['launch', project, folder, chat, start])
        return `session-${chat}`
      },
      send: async (project, chat, start) => {
        calls.push(['send', project, chat, start])
        return `session-${chat}`
      },
      stop: async (chat) => {
        calls.push(['stop', chat])
        if (options.stopFails === true) throw fail('chats.noMachine', {})
      },
      title: async (_account, sessionId) => titles.get(sessionId) ?? null,
    },
  }
  const deps: ProjectChatsDeps = {
    store,
    placeOf: async () => ({ machine: OWN, folder: 'C:\\repos\\example-project' }),
    services: (machine) => (machine === OWN && options.offline !== true ? services : undefined),
    sessions: () => sessions,
    accounts: () => [{ key: 'global', agent: 'claude' }, { key: 'codex-work', agent: 'codex' }],
    language: () => 'en',
    changed: () => {},
    log: () => {},
    now: () => clock,
    newId: () => `chat-${String((ids += 1)).padStart(12, '0')}`,
  }
  const chats = new ProjectChats(deps)
  return {
    chats,
    store,
    calls,
    sessions,
    titles,
    close: async () => {
      await writes.settled()
      await db.close()
    },
    tick: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  }
}

describe('ProjectChats', { timeout: 120_000 }, () => {
  it('creates a chat without a session and keeps the choice for the next one', async () => {
    const { chats, calls, close } = await setup()
    try {
      const card = await chats.create(ABC, { account: 'codex-work', model: 'gpt-5.5', effort: 'high' })
      expect(card).toMatchObject({ id: 'chat-000000000001', agent: 'codex', account: 'codex-work', state: 'new', sessionId: null })
      expect(chats.choice(ABC)).toEqual({ account: 'codex-work', model: 'gpt-5.5', effort: 'high' })
      expect(calls).toEqual([])
      await expect(chats.create(ABC, { account: 'nobody', model: null, effort: null })).rejects.toMatchObject({ notice: { code: 'chats.noAccount' } })
    } finally {
      await close()
    }
  })

  it('starts the session with the first message and sends the next into it', async () => {
    const { chats, calls, close } = await setup()
    try {
      const { id } = await chats.create(ABC, { account: 'global', model: 'opus', effort: null })
      const first = await chats.send(id, { text: 'Why is the build slow?', files: [{ name: 'log.txt', data: new Uint8Array([1]) }] })
      expect(calls[0]).toEqual(['launch', ABC, 'C:\\repos\\example-project', id, {
        account: 'global', model: 'opus', effort: null,
        prompt: expect.stringContaining('C:\\repos\\example-project\\.temp\\inbox\\log.txt'),
      }])
      expect(first).toMatchObject({ sessionId: `session-${id}`, title: 'Why is the build slow?', last: { from: 'user', text: 'Why is the build slow?' } })
      await chats.send(id, { text: 'And the tests?', files: [] })
      expect(calls[1]).toEqual(['send', ABC, id, { model: 'opus', effort: null, prompt: 'And the tests?\n' }])
    } finally {
      await close()
    }
  })

  it('refuses a message to an archived or unknown chat and to a machine off the link', async () => {
    const { chats, close } = await setup()
    const offline = await setup({ offline: true })
    try {
      const { id } = await chats.create(ABC, { account: 'global', model: null, effort: null })
      await chats.archive(id)
      await expect(chats.send(id, { text: 'Hello', files: [] })).rejects.toMatchObject({ notice: { code: 'chats.archived' } })
      await expect(chats.send('chat-ffffffffffff', { text: 'Hello', files: [] })).rejects.toMatchObject({ notice: { code: 'chats.unknown' } })
      const other = await offline.chats.create(ABC, { account: 'global', model: null, effort: null })
      await expect(offline.chats.send(other.id, { text: 'Hello', files: [] })).rejects.toMatchObject({ notice: { code: 'chats.noMachine' } })
    } finally {
      await Promise.all([close(), offline.close()])
    }
  })

  it('reads the session: its state, last message, title and unread answer', async () => {
    const { chats, sessions, titles, close, tick } = await setup()
    try {
      const { id } = await chats.create(ABC, { account: 'global', model: null, effort: null })
      await chats.send(id, { text: 'Why is the build slow?', files: [] })
      tick(60_000)
      sessions.push(view(id, `session-${id}`, {
        lastActivityAt: '2026-11-18T10:01:00.000Z',
        feed: [{ kind: 'text', text: 'The tests run twice.', at: '2026-11-18T10:01:00.000Z' } as SessionView['feed'][number]],
      }))
      titles.set(`session-${id}`, 'Slow build')
      await chats.sweep()
      const [card] = chats.list(ABC)
      expect(card).toMatchObject({ title: 'Slow build', state: 'answered', unread: true, last: { from: 'agent', text: 'The tests run twice.' }, context: { tokens: 1_000, window: 200_000 } })
      chats.read(id)
      expect(chats.list(ABC)[0]?.unread).toBe(false)
    } finally {
      await close()
    }
  })

  it('archives a chat a day after its last event, stopping its session, and keeps what it said', async () => {
    const { chats, calls, close, tick } = await setup({ stopFails: true })
    try {
      const { id } = await chats.create(ABC, { account: 'global', model: null, effort: null })
      await chats.send(id, { text: 'Why is the build slow?', files: [] })
      await expect(chats.archive(id)).rejects.toMatchObject({ notice: { code: 'chats.noMachine' } })
      tick(ARCHIVE_AFTER_MS - 1_000)
      await chats.sweep()
      expect(chats.list(ABC)).toHaveLength(1)
      tick(1_000)
      await chats.sweep()
      expect(chats.list(ABC)).toEqual([])
      expect(calls.filter(([name]) => name === 'stop')).toEqual([['stop', id], ['stop', id]])
      const page = await chats.archived(ABC, 'slow', 0)
      expect(page).toEqual({ chats: [expect.objectContaining({ id, state: 'archived', last: expect.objectContaining({ from: 'user' }) })], more: false })
    } finally {
      await close()
    }
  })

  it('archives with the successor that goes on in a new session', async () => {
    const { chats, close } = await setup()
    try {
      const old = await chats.create(ABC, { account: 'global', model: null, effort: null })
      const next = await chats.create(ABC, { account: 'global', model: null, effort: null })
      await chats.archive(old.id, { successor: next.id })
      expect(await chats.card(old.id)).toMatchObject({ state: 'archived', successor: next.id })
    } finally {
      await close()
    }
  })
})
