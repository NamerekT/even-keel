import { describe, expect, it } from 'vitest'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { setLanguage } from '../i18n/index.js'
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

  it('names a compaction and what it saved (BTN-1703)', () => {
    setLanguage('en')
    expect(feedParts(line({ kind: 'compact', saved: 199_318 })).lines).toEqual(['Context compacted, saved 199.3k tokens'])
    expect(feedParts(line({ kind: 'compact' })).lines).toEqual(['Context compacted'])
  })
})
