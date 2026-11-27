import { describe, expect, it } from 'vitest'
import type { ChatCard, ChatState } from '../../../src/chats/model.js'
import { chatActions, chatChip, chatTone, chatsBadge, contextPercent, modelText } from './projectChats.js'

function card(state: ChatState, unread = false): ChatCard {
  return {
    id: `chat-${state}`,
    project: 'p',
    title: null,
    agent: 'claude',
    account: 'a',
    model: null,
    effort: null,
    state,
    context: null,
    last: null,
    lastAt: '2026-11-19T10:00:00Z',
    unread,
    sessionId: null,
    archivedAt: null,
    successor: null,
    previous: null,
  }
}

describe('the badge of the Chats tab', () => {
  it('has none while no chat waits and none is unread', () => {
    expect(chatsBadge([card('answered'), card('working')])).toBeNull()
  })

  it('counts the unread answers in blue', () => {
    expect(chatsBadge([card('answered', true), card('cold', true), card('working')])).toEqual({ count: 2, tone: 'unread' })
  })

  it('counts the chats that wait for the user in amber, ahead of the unread ones', () => {
    expect(chatsBadge([card('waiting'), card('answered', true), card('waiting', true)])).toEqual({ count: 2, tone: 'waiting' })
  })
})

describe('the colour of a chat', () => {
  it('follows what the chat does', () => {
    const tones = (['new', 'starting', 'working', 'waiting', 'answered', 'cold', 'error', 'archived'] as const).map(chatTone)
    expect(tones).toEqual(['idle', 'working', 'working', 'waiting', 'answered', 'idle', 'error', 'idle'])
  })
})

describe('the chip of a chat', () => {
  it('names a question, the work and a cold cache, nothing else', () => {
    expect(chatChip('waiting')).toBe('question')
    expect(chatChip('working')).toBe('working')
    expect(chatChip('starting')).toBe('working')
    expect(chatChip('cold')).toBe('cold')
    expect(chatChip('answered')).toBeNull()
    expect(chatChip('error')).toBeNull()
  })
})

describe('the model tag', () => {
  it("names the model short, by its catalogue's name when the session has one", () => {
    expect(modelText('claude-sonnet-5-5', 'default')).toBe('Sonnet 5.5')
    expect(modelText('openai/gpt-6.1-sol', 'default')).toBe('GPT-6.1-sol')
    expect(modelText('opencode/qwen3-coder:free', 'default', 'Qwen: Qwen3 Coder (free)')).toBe('Qwen3 Coder')
  })

  it('names the default model when none was chosen', () => {
    expect(modelText(null, 'default')).toBe('default')
  })
})

describe('the context of a chat', () => {
  it('is a share of the window', () => {
    expect(contextPercent({ tokens: 24_000, window: 200_000 })).toBe(12)
  })

  it('is unknown without a session or a window', () => {
    expect(contextPercent(null)).toBeNull()
    expect(contextPercent({ tokens: 1_000, window: null })).toBeNull()
    expect(contextPercent({ tokens: 0, window: 200_000 })).toBeNull()
  })
})

describe('the ⋯ menu of a chat (BTN-1775)', () => {
  it('archives a chat with a session in any state, a question and a turn too', () => {
    for (const state of ['working', 'waiting', 'answered', 'cold', 'error'] as const) {
      expect(chatActions({ ...card(state), sessionId: 's-1' })).toEqual(['archive'])
    }
  })

  it('deletes an empty chat, one with no session yet', () => {
    expect(chatActions(card('new'))).toEqual(['delete'])
  })

  it('archives a chat whose first session is starting: it has one already', () => {
    expect(chatActions(card('starting'))).toEqual(['archive'])
  })

  it('has none for an archived chat', () => {
    expect(chatActions({ ...card('archived'), sessionId: 's-1', archivedAt: '2026-11-19T11:00:00Z' })).toEqual([])
  })
})
