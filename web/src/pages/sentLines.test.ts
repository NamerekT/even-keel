import { describe, expect, it } from 'vitest'
import { USER_MESSAGE_HEAD } from '../../../src/chain/user-message.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { sentFeed, shownLines, type SentLine } from './sentLines.js'

const text = (at: string, words: string): FeedLine => ({ kind: 'text', at, text: words })
const prompt = (at: string, words: string): FeedLine => ({ kind: 'prompt', at, text: words })
const sent = (id: number, line: FeedLine, after: number, extra: Partial<SentLine> = {}): SentLine => ({ id, line, after, midTurn: false, ...extra })

describe('sentFeed', () => {
  it('shows a sent line after the transcript, delivering, until the transcript has a reply after it', () => {
    const lines = [prompt('10:00', 'Start'), text('10:01', 'Done')]
    const mine = prompt('10:02', 'Next')
    const feed = sentFeed(lines, [sent(1, mine, 2)])
    expect(feed.all).toEqual([...lines, mine])
    expect(feed.marks.get(mine)).toEqual({ key: 'sent-1', delivery: 'delivering' })
    expect(feed.marks.get(lines[0]!)).toEqual({ key: null, delivery: 'delivered' })
    expect(feed.marks.has(lines[1]!)).toBe(false)
  })

  it('gives the landed transcript line the key of the sent one, delivered', () => {
    const lines = [prompt('10:00', 'Start'), text('10:01', 'Done'), text('10:02', 'Late'), prompt('10:03', 'Next')]
    const feed = sentFeed(lines, [sent(1, prompt('10:02', 'Next'), 2)])
    expect(feed.all).toEqual(lines)
    expect(feed.unread).toEqual([])
    expect(feed.marks.get(lines[3]!)).toEqual({ key: 'sent-1', delivery: 'delivered' })
  })

  it('keeps a failed line in the feed without its answers, never counted as read, and drops one with nothing left', () => {
    const words = { ...prompt('10:02', 'Why?'), kind: 'answer' as const, answers: { ask: 'toolu_1', answers: { Which: 'A' } } }
    const bare = { kind: 'answer' as const, at: '10:03', text: '', answers: { ask: 'toolu_2', answers: { Which: 'B' } } }
    const lines = [prompt('10:00', 'Start'), prompt('10:05', 'Later')]
    const feed = sentFeed(lines, [sent(1, words, 1, { failed: true }), sent(2, bare, 1, { failed: true })])
    expect(feed.all).toEqual([lines[0], { ...words, answers: undefined }, lines[1]])
    expect(feed.marks.get(feed.all[1]!)).toEqual({ key: 'sent-1', delivery: 'failed' })
    expect(feed.unread.map((each) => each.id)).toEqual([1, 2])
  })

  it('keeps a mid-turn send in place when a different user message lands', () => {
    const mine = prompt('10:02', 'Mind X')
    const other = prompt('10:03', 'From another window')
    const feed = sentFeed([prompt('10:00', 'Start'), other], [sent(1, mine, 1, { midTurn: true })])
    expect(feed.all).toEqual([prompt('10:00', 'Start'), mine, other])
    expect(feed.marks.get(mine)?.delivery).toBe('delivering')
  })

  it('claims one transcript reply per sent line, in order', () => {
    const lines = [prompt('10:00', 'One'), prompt('10:01', 'Two')]
    const feed = sentFeed(lines, [sent(1, prompt('10:00', 'One'), 0), sent(2, prompt('10:01', 'Two'), 0)])
    expect(feed.marks.get(lines[0]!)?.key).toBe('sent-1')
    expect(feed.marks.get(lines[1]!)?.key).toBe('sent-2')
  })

  it('moves the key to the user message split out of the first prompt', () => {
    const first = prompt('10:00', `Handoff note\n${USER_MESSAGE_HEAD.en}\n\nHello`)
    const feed = sentFeed([first], [sent(1, prompt('10:00', 'Hello'), 0, { first: true })])
    const marked = feed.all.filter((line) => feed.marks.get(line)?.key === 'sent-1')
    expect(marked).toHaveLength(1)
    expect(marked[0]).toBe(feed.all.at(-1))
  })
})

describe('shownLines (BTN-1698)', () => {
  const mail = sent(0, prompt('09:00', 'From the inbox'), 0, { id: 'mail-3', midTurn: true, mailId: 3 })
  const opening = sent(0, prompt('09:00', 'Opening'), 0, { first: true })
  const read = [prompt('09:00', 'Opening'), text('09:01', 'Working on it')]

  it("keeps the loader over a session's mail letters until the transcript is read", () => {
    expect(shownLines('s1', undefined, [mail])).toEqual({ lines: undefined, awaitingFirstPrompt: false, starting: false })
  })

  it('keeps the loader over a reopened chat\'s first message, and the session does not look starting', () => {
    expect(shownLines('s1', undefined, [opening])).toEqual({ lines: undefined, awaitingFirstPrompt: false, starting: false })
  })

  it('shows the transcript once read, the letters mixed in by sentFeed', () => {
    expect(shownLines('s1', read, [mail, opening])).toEqual({ lines: read, awaitingFirstPrompt: false, starting: false })
  })

  it('waits for the first prompt only when the read transcript has none', () => {
    expect(shownLines('s1', [], [opening])).toEqual({ lines: [], awaitingFirstPrompt: true, starting: true })
    expect(shownLines('s1', null, [opening])).toEqual({ lines: [], awaitingFirstPrompt: true, starting: true })
  })

  it('shows a message at once while there is no session to read', () => {
    const mine = sent(0, prompt('09:00', 'Hello'), 0, { first: true, afterMail: 0 })
    expect(shownLines(null, undefined, [mine])).toEqual({ lines: [], awaitingFirstPrompt: true, starting: true })
  })

  it('keeps showing a message sent from this window while the session it started is read', () => {
    const mine = sent(0, prompt('09:00', 'Hello'), 0, { first: true, afterMail: 0 })
    expect(shownLines('s1', undefined, [mine])).toEqual({ lines: [], awaitingFirstPrompt: true, starting: true })
  })

  it('shows nothing found for a missing transcript with no sends', () => {
    expect(shownLines('s1', null, [])).toEqual({ lines: null, awaitingFirstPrompt: false, starting: false })
  })
})
