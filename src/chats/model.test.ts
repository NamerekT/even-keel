import { describe, expect, it } from 'vitest'
import type { SessionView } from '../state.js'
import { archiveDue, cardOf, isChatName, lastAtOf, lastMessageOf, SAID_CHARS, sortActive, stateOf, unreadOf, withSaid, type ChatCard, type ChatRecord } from './model.js'

const NOW = new Date('2026-11-18T12:00:00.000Z')

const view = (fields: Partial<SessionView> = {}): SessionView => ({
  task: 'chat-0123456789ab',
  sessionId: 'session-1',
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
  startedAt: '2026-11-18T11:00:00.000Z',
  lastActivityAt: '2026-11-18T11:58:00.000Z',
  contextTokens: 42_000,
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

const chat = (fields: Partial<ChatRecord> = {}): ChatRecord => ({
  id: 'chat-0123456789ab',
  project: '11111111-1111-4111-8111-111111111111',
  agent: 'claude',
  account: 'global',
  model: 'opus',
  effort: 'high',
  title: null,
  first: 'Why is the build slow?',
  said: 'Why is the build slow?',
  last: null,
  sessionId: 'session-1',
  machine: 'machine-1',
  createdAt: '2026-11-18T11:00:00.000Z',
  lastAt: '2026-11-18T11:00:00.000Z',
  readAt: null,
  archivedAt: null,
  successor: null,
  previous: null,
  pending: null,
  ...fields,
})

describe('chat names', () => {
  it('takes only the names Even Keel gives chats', () => {
    expect(isChatName('chat-0123456789ab')).toBe(true)
    expect(isChatName('ABC-12')).toBe(false)
    expect(isChatName('chat-')).toBe(false)
    expect(isChatName('chat-0123456789AB')).toBe(false)
    expect(isChatName(undefined)).toBe(false)
  })
})

describe('the archive after a day', () => {
  it('counts from the later of the record and the session', () => {
    expect(lastAtOf(chat(), view())).toBe('2026-11-18T11:58:00.000Z')
    expect(lastAtOf(chat({ lastAt: '2026-11-18T11:59:00.000Z' }), view())).toBe('2026-11-18T11:59:00.000Z')
    expect(lastAtOf(chat(), undefined)).toBe('2026-11-18T11:00:00.000Z')
  })

  it('is due 24 hours after the last event, not before', () => {
    expect(archiveDue('2026-11-17T12:00:00.000Z', NOW)).toBe(true)
    expect(archiveDue('2026-11-17T12:00:01.000Z', NOW)).toBe(false)
  })
})

describe('the state of a chat', () => {
  it('is new before its first message and starting while its session launches', () => {
    expect(stateOf(chat({ sessionId: null }), undefined, false, NOW)).toBe('new')
    expect(stateOf(chat({ sessionId: null }), undefined, true, NOW)).toBe('starting')
  })

  it('puts waiting for the user over working', () => {
    expect(stateOf(chat(), view({ lamp: 'working' }), false, NOW)).toBe('working')
    expect(stateOf(chat(), view({ lamp: 'working', waitingFor: 'permission' }), false, NOW)).toBe('waiting')
    expect(stateOf(chat(), view({ asking: true }), false, NOW)).toBe('waiting')
  })

  it('allows time for the first session report and still recognizes a missing cold session', () => {
    const last = { from: 'user' as const, text: 'Hello', at: NOW.toISOString() }
    expect(stateOf(chat({ last }), undefined, false, NOW)).toBe('starting')
    expect(stateOf(chat({ last }), view({ lamp: 'working' }), false, NOW)).toBe('working')
    expect(stateOf(chat({ last }), undefined, false, new Date(NOW.getTime() + 300_000))).toBe('cold')
    expect(stateOf(chat({ last: { ...last, from: 'agent' } }), undefined, false, NOW)).toBe('cold')
  })

  it('tells a warm cache from a cold one, and an error', () => {
    expect(stateOf(chat(), view({ cache: { ttl: '5m', until: '2026-11-18T12:03:00.000Z' } }), false, NOW)).toBe('answered')
    expect(stateOf(chat(), view({ cache: { ttl: '5m', until: '2026-11-18T11:59:00.000Z' } }), false, NOW)).toBe('cold')
    expect(stateOf(chat(), view({ lastActivityAt: '2026-11-18T11:58:00.000Z' }), false, NOW)).toBe('answered')
    expect(stateOf(chat(), view({ lastActivityAt: '2026-11-18T11:50:00.000Z' }), false, NOW)).toBe('cold')
    expect(stateOf(chat(), view({ lamp: 'limit' }), false, NOW)).toBe('error')
    expect(stateOf(chat(), view({ apiErrorKind: 'auth' }), false, NOW)).toBe('error')
    expect(stateOf(chat({ archivedAt: '2026-11-18T11:00:00.000Z' }), view({ lamp: 'working' }), false, NOW)).toBe('archived')
  })
})

describe('the last message', () => {
  it('is the newest line with words, the user\'s or the agent\'s', () => {
    const feed = [
      { at: '2026-11-18T11:50:00.000Z', kind: 'prompt' as const, text: 'Why is the build slow?' },
      { at: '2026-11-18T11:51:00.000Z', kind: 'text' as const, text: 'The tests run twice.' },
      { at: '2026-11-18T11:52:00.000Z', kind: 'tool' as const, text: 'Read' },
    ]
    expect(lastMessageOf(view({ feed }))).toEqual({ from: 'agent', text: 'The tests run twice.', at: '2026-11-18T11:51:00.000Z' })
    expect(lastMessageOf(view({ feed: feed.slice(0, 1) }))?.from).toBe('user')
  })

  it('is the question the session asks', () => {
    const ask = { id: 'call-1', questions: [{ question: 'Which branch?', header: 'Branch', options: [], multiSelect: false }] }
    expect(lastMessageOf(view({ ask }))).toMatchObject({ from: 'ask', text: 'Which branch?' })
  })

  it('is unread when the agent wrote after the user opened the chat', () => {
    const last = { from: 'agent' as const, text: 'Done.', at: '2026-11-18T11:51:00.000Z' }
    expect(unreadOf(last, null)).toBe(true)
    expect(unreadOf(last, '2026-11-18T11:50:00.000Z')).toBe(true)
    expect(unreadOf(last, '2026-11-18T11:52:00.000Z')).toBe(false)
    expect(unreadOf({ ...last, from: 'user' }, null)).toBe(false)
  })
})

describe('what the user said', () => {
  it('keeps the newest words', () => {
    expect(withSaid('', ' First ')).toBe('First')
    expect(withSaid('First', 'Second')).toBe('First\nSecond')
    const long = withSaid('x'.repeat(SAID_CHARS), 'tail')
    expect(long.length).toBe(SAID_CHARS)
    expect(long.endsWith('\ntail')).toBe(true)
  })
})

describe('the card', () => {
  it('takes the title from the transcript, else the first message, and the last message from the session', () => {
    const feed = [{ at: '2026-11-18T11:58:00.000Z', kind: 'text' as const, text: 'Done.' }]
    const card = cardOf(chat(), view({ feed }), false, NOW)
    expect(card).toMatchObject({ title: 'Why is the build slow?', state: 'answered', unread: true, context: { tokens: 42_000, window: 200_000 } })
    expect(cardOf(chat({ title: 'Slow build' }), undefined, false, NOW).title).toBe('Slow build')
    expect(cardOf(chat({ title: 'chat-0123456789ab' }), undefined, false, NOW).title).toBe('Why is the build slow?')
  })

  it('of an archived chat keeps the last message it had', () => {
    const last = { from: 'agent' as const, text: 'Kept.', at: '2026-11-17T10:00:00.000Z' }
    const feed = [{ at: '2026-11-18T11:58:00.000Z', kind: 'text' as const, text: 'Later.' }]
    expect(cardOf(chat({ archivedAt: '2026-11-18T10:00:00.000Z', last }), view({ feed }), false, NOW).last).toEqual(last)
  })

  it('lists the chats that wait first, then the newest', () => {
    const card = (id: string, state: ChatCard['state'], lastAt: string) => ({ ...cardOf(chat({ id }), undefined, false, NOW), state, lastAt })
    const sorted = sortActive([card('a', 'answered', '2026-11-18T11:00:00.000Z'), card('b', 'cold', '2026-11-18T11:30:00.000Z'), card('c', 'waiting', '2026-11-18T10:00:00.000Z')])
    expect(sorted.map((each) => each.id)).toEqual(['c', 'b', 'a'])
  })
})
