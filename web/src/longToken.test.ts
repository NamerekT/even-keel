import { describe, expect, it } from 'vitest'
import { t } from './i18n/index.js'
import { tokenDay, tokenProblem, tokenState, tokenTag } from './longToken.js'

const now = new Date('2026-11-15T12:00:00.000Z')

describe('a long token on the page (BTN-1005)', () => {
  it('is fine until a month before its last day, then ending, then over', () => {
    expect(tokenState({ until: '2027-11-15T12:00:00.000Z' }, now)).toBe('fine')
    expect(tokenState({ until: '2026-12-15T12:00:01.000Z' }, now)).toBe('fine')
    expect(tokenState({ until: '2026-12-15T12:00:00.000Z' }, now)).toBe('ending')
    expect(tokenState({ until: '2026-11-15T12:00:00.000Z' }, now)).toBe('over')
  })

  it('is refused whatever its day, and fine with no day known', () => {
    expect(tokenState({ until: '2027-11-15T12:00:00.000Z', refusedAt: '2026-11-14T00:00:00.000Z' }, now)).toBe('refused')
    expect(tokenState({ until: null }, now)).toBe('fine')
    expect(tokenState({ until: null, refusedAt: '2026-11-14T00:00:00.000Z' }, now)).toBe('refused')
  })

  it('names its last day in the tag when it is known', () => {
    expect(tokenDay({ until: null })).toBeNull()
    expect(tokenTag({ until: null })).toBe('long token')
    expect(tokenTag({ until: '2027-11-15T12:00:00.000Z' })).toBe('long token until 15 Nov 2027')
  })

  it('says what is wrong only when something is', () => {
    expect(tokenProblem({ until: '2027-11-15T12:00:00.000Z' }, now)).toBeNull()
    expect(tokenProblem({ until: '2026-11-30T12:00:00.000Z' }, now)).toBe('The token ends on 30 Nov 2026: issue a new one')
    expect(tokenProblem({ until: '2026-11-01T12:00:00.000Z' }, now)).toBe('The token ran out on 1 Nov 2026: issue a new one')
    expect(tokenProblem({ until: null, refusedAt: '2026-11-14T00:00:00.000Z' }, now)).toBe(t.account.tokenRefused)
  })
})
