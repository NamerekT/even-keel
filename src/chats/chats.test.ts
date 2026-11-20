import { describe, expect, it } from 'vitest'
import { ABC } from '../storage/database.fixture.js'
import type { SessionView } from '../state.js'
import { setup, view } from './chats.fixture.js'
import { ARCHIVE_AFTER_MS } from './model.js'

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
      expect(first.state).toBe('starting')
      expect(chats.list(ABC)[0]?.state).toBe('starting')
      await chats.send(id, { text: 'And the tests?', files: [] })
      expect(calls[1]).toEqual(['send', ABC, id, { model: 'opus', effort: null, prompt: 'And the tests?\n' }])
    } finally {
      await close()
    }
  })

  it("resumes a chat's session with the mail its hooks missed at the end of a turn, and not an archived one (BTN-1346)", async () => {
    const { chats, calls, close } = await setup()
    try {
      const { id } = await chats.create(ABC, { account: 'global', model: 'opus', effort: null })
      await chats.send(id, { text: 'Why is the build slow?', files: [] })
      await expect(chats.resume(id, `session-${id}`, 'And the tests?')).resolves.toBe(true)
      expect(calls[1]).toEqual(['send', ABC, id, { model: 'opus', effort: null, prompt: 'And the tests?' }])
      await expect(chats.resume(id, 'session-other', 'Hello')).resolves.toBe(false)
      await chats.archive(id)
      await expect(chats.resume(id, `session-${id}`, 'Hello')).resolves.toBe(false)
      await expect(chats.resume('chat-ffffffffffff', 'session-1', 'Hello')).resolves.toBe(false)
      expect(calls.filter((call) => call[0] === 'send')).toHaveLength(1)
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

  it('drops a kept title that is only the name its session was launched under (BTN-1339)', async () => {
    const { chats, store, close, tick } = await setup()
    try {
      const { id } = await chats.create(ABC, { account: 'global', model: null, effort: null })
      await chats.send(id, { text: 'Why is the build slow?', files: [] })
      tick(60_000)
      store.put({ ...store.get(id)!, title: id })
      await chats.sweep()
      expect(store.get(id)?.title).toBeNull()
      expect(chats.list(ABC)[0]?.title).toBe('Why is the build slow?')
    } finally {
      await close()
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
