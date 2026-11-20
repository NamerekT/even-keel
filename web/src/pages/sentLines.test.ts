import { describe, expect, it } from 'vitest'
import { USER_MESSAGE_HEAD } from '../../../src/chain/user-message.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { sentFeed, type SentLine } from './sentLines.js'

const text = (at: string, words: string): FeedLine => ({ kind: 'text', at, text: words })
const prompt = (at: string, words: string): FeedLine => ({ kind: 'prompt', at, text: words })
const sent = (id: number, line: FeedLine, after: number, extra: Partial<SentLine> = {}): SentLine => ({ id, line, after, steered: false, ...extra })

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
    expect(feed.all.slice(2)).toEqual([{ ...words, answers: undefined }])
    expect(feed.marks.get(feed.all[2]!)).toEqual({ key: 'sent-1', delivery: 'failed' })
    expect(feed.unread.map((each) => each.id)).toEqual([1, 2])
  })

  it('leaves a steered line out of the feed until the transcript has it', () => {
    const mine = prompt('10:02', 'Mind X')
    expect(sentFeed([prompt('10:00', 'Start')], [sent(1, mine, 1, { steered: true })]).all).toEqual([prompt('10:00', 'Start')])
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
