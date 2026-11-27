import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { insertRows, rowsOf } from '../storage/copy.js'
import { ABC, fixture, readsWhole, schemaOf } from '../storage/database.fixture.js'
import { openDatabase, STEPS, Writes } from '../storage/database.js'
import type { ChatRecord } from './model.js'
import { ChatStore, loadChatSessions } from './store.js'

const writes = () => new Writes((line) => { throw new Error(line) })

const chat = (id: string, fields: Partial<ChatRecord> = {}): ChatRecord => ({
  id,
  project: ABC,
  agent: 'claude',
  account: 'global',
  model: null,
  effort: null,
  title: null,
  name: null,
  first: null,
  said: '',
  last: null,
  sessionId: null,
  machine: null,
  createdAt: '2026-11-18T10:00:00.000Z',
  lastAt: '2026-11-18T10:00:00.000Z',
  readAt: null,
  archivedAt: null,
  successor: null,
  previous: null,
  pending: null,
  handover: null,
  packages: {},
  ...fields,
})

describe('step 63: the project chats (BTN-1230)', { timeout: 120_000 }, () => {
  it('makes the tables of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 61))
    try {
      await frozen.exec(fixture(63))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 63, 63)
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
      // The store reads the schema of today: the sample brought to step 64 has nothing pending, to 86 no packages, to 87
      // no machine of the choice, to 88 no name of the user's, to 90 no hand-over.
      await frozen.exec(STEPS[61]!)
      await frozen.exec(STEPS[83]!)
      await frozen.exec(STEPS[84]!)
      await frozen.exec(STEPS[85]!)
      await frozen.exec(STEPS[87]!)
      const store = await ChatStore.open({ db: frozen, writes: writes() })
      expect(store.active().every((each) => each.pending === null)).toBe(true)
      expect(store.active(ABC).map((each) => [each.id, each.sessionId, each.machine])).toEqual([
        ['chat-aaaaaaaaaaaa', 'aaaaaaaa-1111-4222-8333-444444444444', '88888888-8888-4888-8888-888888888888'],
        ['chat-bbbbbbbbbbbb', null, null],
      ])
      expect(store.get('chat-aaaaaaaaaaaa')).toMatchObject({
        title: 'Slow build',
        said: 'Why is the build slow?\nAnd the tests?',
        last: { from: 'agent', text: 'The tests run twice.' },
        lastAt: '2026-11-19T10:05:00.000Z',
        readAt: '2026-11-19T10:03:20.000Z',
      })
      expect(store.choice(ABC)).toEqual({ account: 'global', model: 'opus', effort: 'high' })
      const archive = await store.archived(ABC, '', 0)
      expect(archive).toEqual({ chats: [expect.objectContaining({ id: 'chat-cccccccccccc', successor: 'chat-aaaaaaaaaaaa' })], more: false })
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })
})

describe('step 64: the pending prompt of a chat going on in a new session (BTN-1232)', { timeout: 120_000 }, () => {
  it('adds the column of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 62))
    try {
      await frozen.exec(fixture(64))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 64, 64)
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
      await frozen.exec(STEPS[83]!)
      await frozen.exec(STEPS[84]!)
      await frozen.exec(STEPS[85]!)
      await frozen.exec(STEPS[87]!)
      const store = await ChatStore.open({ db: frozen, writes: writes() })
      expect(store.get('chat-dddddddddddd')).toMatchObject({ sessionId: null, previous: 'chat-eeeeeeeeeeee', pending: expect.stringContaining('Fix the header') })
      expect(store.get('chat-aaaaaaaaaaaa')?.pending).toBeNull()
      expect((await store.find('chat-eeeeeeeeeeee'))?.successor).toBe('chat-dddddddddddd')
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })
})

describe("step 86: a chat's own choice of packages (BTN-1696)", { timeout: 120_000 }, () => {
  it('adds the columns of the frozen sample, reads its rows, and none for the chats before it', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 84))
    const upgraded = await PGlite.create()
    try {
      await frozen.exec(fixture(86))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 86, 86)
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
      const own = { 'lint@example': true, 'huly@even-keel': false }
      await frozen.exec(STEPS[84]!)
      await frozen.exec(STEPS[85]!)
      await frozen.exec(STEPS[87]!)
      const store = await ChatStore.open({ db: frozen, writes: writes() })
      expect(store.get('chat-aaaaaaaaaaaa')?.packages).toEqual(own)
      expect(store.get('chat-bbbbbbbbbbbb')?.packages).toEqual({})
      expect(store.choice(ABC)).toEqual({ account: 'global', model: 'opus', effort: 'high', packages: own })
      await upgraded.exec(fixture(85))
      await upgraded.exec(STEPS[83]!)
      expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
      await upgraded.exec(STEPS[84]!)
      await upgraded.exec(STEPS[85]!)
      await upgraded.exec(STEPS[87]!)
      const before = await ChatStore.open({ db: upgraded, writes: writes() })
      expect(before.active().map((each) => each.packages)).toEqual([{}, {}, {}])
      expect(before.choice(ABC)).toEqual({ account: 'global', model: 'opus', effort: 'high' })
    } finally {
      await Promise.all([frozen.close(), made.close(), upgraded.close()])
    }
  })
})

describe('step 87: the machine of the last chat choice (BTN-1710)', { timeout: 120_000 }, () => {
  it('adds the column of the frozen sample, reads its rows, and no machine for the choices before it', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 85))
    const upgraded = await PGlite.create()
    try {
      await frozen.exec(fixture(87))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 87, 87)
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
      await frozen.exec(STEPS[85]!)
      await frozen.exec(STEPS[87]!)
      const store = await ChatStore.open({ db: frozen, writes: writes() })
      expect(store.choice(ABC)).toMatchObject({ account: 'global', machine: '88888888-8888-4888-8888-888888888888' })
      await upgraded.exec(fixture(86))
      await upgraded.exec(STEPS[84]!)
      expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
      await upgraded.exec(STEPS[85]!)
      await upgraded.exec(STEPS[87]!)
      const before = await ChatStore.open({ db: upgraded, writes: writes() })
      expect(before.choice(ABC)).not.toHaveProperty('machine')
    } finally {
      await Promise.all([frozen.close(), made.close(), upgraded.close()])
    }
  })
})

describe("step 88: the user's name of a chat (BTN-1774)", { timeout: 120_000 }, () => {
  it('adds the column of the frozen sample, reads its rows, and no name for the chats before it', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 86))
    const upgraded = await PGlite.create()
    try {
      await frozen.exec(fixture(88))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 88, 88)
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
      await frozen.exec(STEPS[87]!)
      const store = await ChatStore.open({ db: frozen, writes: writes() })
      expect(store.get('chat-aaaaaaaaaaaa')).toMatchObject({ name: 'Build speed', title: 'Slow build' })
      expect(store.get('chat-bbbbbbbbbbbb')?.name).toBeNull()
      await upgraded.exec(fixture(87))
      await upgraded.exec(STEPS[85]!)
      expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
      await upgraded.exec(STEPS[87]!)
      const before = await ChatStore.open({ db: upgraded, writes: writes() })
      expect(before.active().map((each) => each.name)).toEqual([null, null, null])
    } finally {
      await Promise.all([frozen.close(), made.close(), upgraded.close()])
    }
  })
})

describe('step 90: the hand-over of a chat continued early (BTN-1776)', { timeout: 120_000 }, () => {
  it('adds the column of the frozen sample, reads its rows, and no hand-over for the chats before it', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 88))
    const upgraded = await PGlite.create()
    try {
      await frozen.exec(fixture(90))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 90, 90)
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
      const store = await ChatStore.open({ db: frozen, writes: writes() })
      expect(store.get('chat-ffffffffffff')).toMatchObject({ sessionId: null, pending: null, previous: 'chat-999999999999', name: 'Release plan', handover: expect.stringContaining('- You: Three steps.') })
      expect(store.get('chat-aaaaaaaaaaaa')?.handover).toBeNull()
      expect((await store.find('chat-999999999999'))?.successor).toBe('chat-ffffffffffff')
      await upgraded.exec(fixture(89))
      await upgraded.exec(STEPS[87]!)
      expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
      const before = await ChatStore.open({ db: upgraded, writes: writes() })
      expect(before.active().map((each) => each.handover)).toEqual([null, null, null])
    } finally {
      await Promise.all([frozen.close(), made.close(), upgraded.close()])
    }
  })
})

describe('the chat store', { timeout: 120_000 }, () => {
  it('keeps a chat and the choice over a reopening, and an archived one only in the archive', async () => {
    const db = await openDatabase(undefined)
    try {
      const kept = writes()
      const store = await ChatStore.open({ db, writes: kept })
      store.put(chat('chat-000000000001', { first: 'Hello', said: 'Hello', sessionId: 'session-1', machine: 'machine-1', last: { from: 'user', text: 'Hello', at: '2026-11-18T10:00:00.000Z' }, pending: 'Hello\n' }))
      store.put(chat('chat-000000000002', { archivedAt: '2026-11-18T11:00:00.000Z', successor: 'chat-000000000001' }))
      store.put(chat('chat-000000000003', { packages: { 'lint@example': true }, name: 'Build speed' }))
      store.setChoice(ABC, { account: 'work', model: 'sonnet', effort: null, packages: { 'lint@example': false }, machine: 'machine-1' })
      await kept.settled()
      const again = await ChatStore.open({ db, writes: writes() })
      expect(again.active().map((each) => each.id)).toEqual(['chat-000000000001', 'chat-000000000003'])
      expect(again.get('chat-000000000001')).toEqual(store.get('chat-000000000001'))
      expect(again.get('chat-000000000003')).toMatchObject({ packages: { 'lint@example': true }, name: 'Build speed' })
      expect(again.choice(ABC)).toEqual({ account: 'work', model: 'sonnet', effort: null, packages: { 'lint@example': false }, machine: 'machine-1' })
      expect((await again.find('chat-000000000002'))?.successor).toBe('chat-000000000001')
    } finally {
      await db.close()
    }
  })

  it("hands a machine its active chats' sessions, none archived or of another machine (BTN-1772)", async () => {
    const db = await openDatabase(undefined)
    try {
      const kept = writes()
      const store = await ChatStore.open({ db, writes: kept })
      store.put(chat('chat-000000000001', { sessionId: 'session-1', machine: 'machine-1' }))
      store.put(chat('chat-000000000002', { sessionId: 'session-2', machine: 'machine-1', archivedAt: '2026-11-18T11:00:00.000Z' }))
      store.put(chat('chat-000000000003', { sessionId: 'session-3', machine: 'machine-2' }))
      store.put(chat('chat-000000000004', { machine: 'machine-1', pending: 'Hello\n' }))
      await kept.settled()
      expect(await loadChatSessions(db, 'machine-1')).toEqual([['chat-000000000001', 'session-1']])
    } finally {
      await db.close()
    }
  })

  it('pages the archive newest first and finds the words of the title and the messages', async () => {
    const db = await openDatabase(undefined)
    try {
      const kept = writes()
      const store = await ChatStore.open({ db, writes: kept })
      for (let index = 0; index < 23; index += 1) {
        const at = new Date(Date.parse('2026-11-18T00:00:00.000Z') + index * 60_000).toISOString()
        store.put(chat(`chat-${String(index).padStart(12, '0')}`, { archivedAt: at, said: index === 3 ? 'Mind the 100% case' : 'plain', title: index === 5 ? 'Header fix' : null, name: index === 7 ? 'Footer work' : null }))
      }
      const first = await store.archived(ABC, '', 0)
      expect(first.chats).toHaveLength(20)
      expect(first.chats[0]?.id).toBe('chat-000000000022')
      expect(first.more).toBe(true)
      const second = await store.archived(ABC, '', 1)
      expect(second.chats.map((each) => each.id)).toEqual(['chat-000000000002', 'chat-000000000001', 'chat-000000000000'])
      expect(second.more).toBe(false)
      expect((await store.archived(ABC, '100%', 0)).chats.map((each) => each.id)).toEqual(['chat-000000000003'])
      expect((await store.archived(ABC, 'header', 0)).chats.map((each) => each.id)).toEqual(['chat-000000000005'])
      expect((await store.archived(ABC, 'footer', 0)).chats.map((each) => each.id)).toEqual(['chat-000000000007'])
      expect((await store.archived(ABC, '_', 0)).chats).toEqual([])
      expect((await store.archived('other', '', 0)).chats).toEqual([])
    } finally {
      await db.close()
    }
  })
})
