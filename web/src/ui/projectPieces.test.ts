import { describe, expect, it } from 'vitest'
import { piecesOf } from './projectPieces.js'

const GUID = '6a1f0c2e-0b4d-4c55-9a3e-2f7d1b8c9e01'

describe('piecesOf', () => {
  it('cuts the text at every project id it names', () => {
    expect(piecesOf(`The next task of ${GUID}, DEMO waits.`, [GUID, 'DEMO'])).toEqual([
      'The next task of ',
      { project: GUID },
      ', ',
      { project: 'DEMO' },
      ' waits.',
    ])
  })

  it('keeps a text without ids whole', () => {
    expect(piecesOf('Nothing here.', ['ABC'])).toEqual(['Nothing here.'])
  })

  it('does not take an id that is part of a task id or a longer word', () => {
    expect(piecesOf('ABC-5 of ABC waits for ABC-FIX, not ABCD or XABC.', ['ABC'])).toEqual(['ABC-5 of ', { project: 'ABC' }, ' waits for ABC-FIX, not ABCD or XABC.'])
  })

  it('takes an id at the edges of the text and before punctuation', () => {
    expect(piecesOf("ABC: the carry into DEMO's branch", ['ABC', 'DEMO'])).toEqual([{ project: 'ABC' }, ': the carry into ', { project: 'DEMO' }, "'s branch"])
  })

  it('prefers the longer id where one is the start of another', () => {
    expect(piecesOf('OPS and OPS_2', ['OPS', 'OPS_2'])).toEqual([{ project: 'OPS' }, ' and ', { project: 'OPS_2' }])
  })
})
