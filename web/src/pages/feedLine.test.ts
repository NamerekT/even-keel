import { describe, expect, it } from 'vitest'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { feedParts } from './feedLine.js'

const line = (fields: Partial<FeedLine>): FeedLine => ({ at: '2026-01-01T00:00:00Z', kind: 'prompt', text: '', ...fields }) as FeedLine

describe('feedParts (BTN-1383)', () => {
  it('keeps the answers and the words a line each and the files by name, glued by nothing', () => {
    const parts = feedParts(line({
      text: 'see the shot',
      answers: { answers: { 'Which branch?': 'main' } } as FeedLine['answers'],
      files: ['D:\\shots\\one.png', '/tmp/two.txt'],
    }))
    expect(parts).toEqual({ lines: ['Which branch? → main', 'see the shot'], files: ['one.png', 'two.txt'] })
  })

  it('drops empty words', () => {
    expect(feedParts(line({ files: ['a/b.png'] }))).toEqual({ lines: [], files: ['b.png'] })
  })
})
