import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { ChatHandover } from '../sessionStart.js'
import { shownHandover, withUserMessage, type HandoverFacts, type LocalHandover } from './chatHandover.js'

const since = '2026-01-01T10:00:00.000Z'
const now = Date.parse('2026-01-01T10:00:10.000Z')
const local: LocalHandover = { since, message: 'Check the logs too.', from: 'old' }
const handing: ChatHandover = { phase: 'handover', since, message: 'Check the logs too.', sessionId: null }
const booting: ChatHandover = { phase: 'boot', since, message: null, sessionId: 'new' }
const line = (text: string): FeedLine => ({ at: since, kind: 'prompt', text })
const facts = (patch: Partial<HandoverFacts>): HandoverFacts => ({ server: null, local: null, held: null, sessionId: 'old', lines: [line('old')], now, ...patch })

describe('shownHandover', () => {
  it('stands from the press, before the service says anything', () => {
    expect(shownHandover(facts({ local }))).toEqual(handing)
  })

  it('gives up on a press the service never took up', () => {
    expect(shownHandover(facts({ local, now: Date.parse('2026-01-01T10:00:30.000Z') }))).toBeNull()
  })

  it('follows the service through its phases, keeping the message it gave earlier', () => {
    expect(shownHandover(facts({ local, server: handing }))).toEqual(handing)
    expect(shownHandover(facts({ local, server: booting, held: handing }))).toEqual({ ...booting, message: 'Check the logs too.' })
    expect(shownHandover(facts({ server: booting, sessionId: 'new', lines: [] }))).toEqual(booting)
  })

  it('leaves once the new session has a line, while the service still waits for its answer', () => {
    expect(shownHandover(facts({ server: { ...booting, phase: 'answer' }, sessionId: 'new', lines: [line('ABC-1')] }))).toBeNull()
  })

  it('stays after the service is done until the window has the new session read, without a Reading loader', () => {
    expect(shownHandover(facts({ held: booting }))).toEqual(booting)
    expect(shownHandover(facts({ held: booting, sessionId: 'new', lines: undefined }))).toEqual(booting)
    expect(shownHandover(facts({ held: booting, sessionId: 'new', lines: [line('ABC-1')] }))).toBeNull()
    expect(shownHandover(facts({ held: booting, sessionId: 'new', lines: null }))).toBeNull()
    expect(shownHandover(facts({ held: booting, now: Date.parse('2026-01-01T10:06:00.000Z') }))).toBeNull()
  })

  it('waits out an empty read made before the service was done, but not for long', () => {
    const released = { ...booting, released: now - 5_000 }
    expect(shownHandover(facts({ held: released, sessionId: 'new', lines: [] }))).toEqual(booting)
    expect(shownHandover(facts({ held: { ...booting, released: now - 25_000 }, sessionId: 'new', lines: [] }))).toBeNull()
  })

  it('shows the old feed again when the handover failed', () => {
    expect(shownHandover(facts({ local, server: { ...handing, error: notice('chain.launching', { task: 'ABC-1' }) } }))).toBeNull()
    expect(shownHandover(facts({ local, held: handing }))).toBeNull()
  })
})

describe('withUserMessage', () => {
  it('splits the message off the session\'s first prompt, with its files', () => {
    const first = { ...line('ABC-1 Continue.\n\nThe user\'s message:\n\nCheck the logs too.\n'), files: ['a.png'] }
    const text: FeedLine = { at: since, kind: 'text', text: 'On it.' }
    expect(withUserMessage([first, text])).toEqual([line('ABC-1 Continue.'), { ...line('Check the logs too.'), files: ['a.png'] }, text])
  })

  it('keeps a feed whose first prompt has no message, or a message in a later prompt', () => {
    const lines = [line('ABC-1 Continue.'), line('The user\'s message:\n\nlater')]
    expect(withUserMessage(lines)).toBe(lines)
  })
})
