import { describe, expect, it } from 'vitest'
import type { AccountEntry } from '../../../src/account/model.js'
import type { ChatCard } from '../../../src/chats/model.js'
import type { RateLimits } from '../../../src/limits/model.js'
import type { SessionView } from '../../../src/state.js'
import { chatRenewal, renewalChoice } from './chatRenewal.js'

const now = new Date('2026-11-19T12:00:00.000Z')
const RESET = '2026-11-19T18:40:00.000Z'

const chat = (patch: Partial<ChatCard> = {}): ChatCard => ({
  id: 'chat-000000000001',
  project: 'p',
  title: 'Slow build',
  agent: 'claude',
  account: 'work',
  model: 'claude-opus-5-5',
  effort: 'high',
  state: 'answered',
  context: { tokens: 182_000, window: 1_000_000 },
  last: null,
  lastAt: '2026-11-19T11:20:00.000Z',
  unread: false,
  sessionId: 'session-1',
  archivedAt: null,
  successor: null,
  previous: null,
  ...patch,
})

const limits = (used: number): RateLimits => ({ fiveHour: { usedPercentage: used, resetsAt: RESET }, sevenDay: { usedPercentage: 10, resetsAt: '2026-11-22T00:00:00.000Z' } }) as RateLimits

const entry = (key: string, agent = 'claude', patch: Partial<AccountEntry> = {}): AccountEntry => ({
  key,
  name: null,
  global: false,
  agent,
  status: null,
  error: null,
  loginExpiresAt: null,
  needsLogin: false,
  sessions: [],
  projects: [],
  removing: false,
  configPending: false,
  apiKey: false,
  limits: limits(40),
  usage: { state: 'ok', reason: null, since: null },
  ...patch,
})

const session = (patch: Partial<SessionView>): SessionView => ({ lamp: 'idle', cache: null, warm: null, contextTokens: 182_000, ...patch }) as SessionView

describe('the question before a message to a project chat (BTN-1232)', () => {
  it('asks when the cache went cold, with when and how much a reply rereads', () => {
    const cold = session({ cache: { until: '2026-11-19T11:20:00.000Z', ttl: '5m' } as SessionView['cache'] })
    expect(chatRenewal(chat(), cold, entry('work'), now)).toEqual({ kind: 'cold', since: '2026-11-19T11:20:00.000Z', tokens: 182_000 })
    const warm = session({ cache: { until: '2026-11-19T12:03:00.000Z', ttl: '5m' } as SessionView['cache'] })
    expect(chatRenewal(chat(), warm, entry('work'), now)).toBeNull()
  })

  it('takes the chat\'s own state without the session\'s view', () => {
    expect(chatRenewal(chat({ state: 'cold' }), undefined, entry('work'), now)).toEqual({ kind: 'cold', since: '2026-11-19T11:20:00.000Z', tokens: 182_000 })
    expect(chatRenewal(chat({ state: 'answered' }), undefined, entry('work'), now)).toBeNull()
  })

  it('asks when the account is at a limit, before a cold cache, with the window and its reset', () => {
    expect(chatRenewal(chat({ state: 'cold' }), undefined, entry('work', 'claude', { limits: limits(100) }), now)).toEqual({ kind: 'limit', span: 'fiveHour', resetsAt: RESET })
    expect(chatRenewal(chat(), session({ lamp: 'limit' }), entry('work'), now)).toEqual({ kind: 'limit', span: null, resetsAt: null })
  })

  it('never asks a chat with no session, at work or archived', () => {
    const spent = entry('work', 'claude', { limits: limits(100) })
    expect(chatRenewal(chat({ sessionId: null, state: 'new' }), undefined, spent, now)).toBeNull()
    expect(chatRenewal(chat({ state: 'working' }), undefined, spent, now)).toBeNull()
    expect(chatRenewal(chat({ archivedAt: now.toISOString(), state: 'archived' }), undefined, spent, now)).toBeNull()
  })
})

describe('the choice the window offers first (BTN-1232)', () => {
  const cold = { kind: 'cold', since: '', tokens: 0 } as const
  const limit = { kind: 'limit', span: 'fiveHour', resetsAt: RESET } as const

  it('is the project\'s last choice for a cold cache', () => {
    const last = { account: 'spare', model: 'claude-sonnet-5-5', effort: 'medium' }
    expect(renewalChoice(chat(), cold, last, [entry('work'), entry('spare')])).toEqual(last)
    expect(renewalChoice(chat(), cold, null, [entry('work')])).toEqual({ account: 'work', model: 'claude-opus-5-5', effort: 'high' })
  })

  it('is the next account with room at a limit, the model kept on the same agent', () => {
    const spent = entry('work', 'claude', { limits: limits(100) })
    expect(renewalChoice(chat(), limit, { account: 'work', model: 'claude-opus-5-5', effort: 'high' }, [spent, entry('codex', 'codex'), entry('spare')])).toEqual({
      account: 'spare',
      model: 'claude-opus-5-5',
      effort: 'high',
    })
    expect(renewalChoice(chat(), limit, null, [spent, entry('codex', 'codex')])).toEqual({ account: 'codex', model: null, effort: 'high' })
    expect(renewalChoice(chat(), limit, { account: 'codex', model: 'gpt-6.1-sol', effort: 'medium' }, [spent, entry('codex', 'codex'), entry('spare')])).toEqual({
      account: 'codex',
      model: 'gpt-6.1-sol',
      effort: 'medium',
    })
  })

  it('stays on the chat\'s account when no other has room', () => {
    const spent = entry('work', 'claude', { limits: limits(100) })
    expect(renewalChoice(chat(), limit, null, [spent, entry('spare', 'claude', { needsLogin: true })])).toEqual({ account: 'work', model: 'claude-opus-5-5', effort: 'high' })
  })

  it("offers the chat's machine, never the last choice's (BTN-1711)", () => {
    const last = { account: 'spare', model: null, effort: 'medium', machine: 'laptop' }
    expect(renewalChoice(chat({ machine: 'pc' }), cold, last, [entry('work'), entry('spare')])).toEqual({ account: 'spare', model: null, effort: 'medium', machine: 'pc' })
    expect(renewalChoice(chat(), cold, last, [entry('work'), entry('spare')])).toEqual({ account: 'spare', model: null, effort: 'medium' })
  })
})
