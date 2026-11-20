import { describe, expect, it } from 'vitest'
import type { ChatCard, ChatState } from '../../../src/chats/model.js'
import { chatChip, chatTone, chatsBadge, contextPercent, modelText } from './projectChats.js'

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
  it('drops the provider from the model', () => {
    expect(modelText('claude-sonnet-5-5', 'default')).toBe('sonnet-5-5')
    expect(modelText('openai/gpt-6.1-sol', 'default')).toBe('gpt-6.1-sol')
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
