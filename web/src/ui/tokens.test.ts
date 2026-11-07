import { describe, expect, it } from 'vitest'
import { shownCaret, tokensOf, tokensShown, typedTokens } from './tokens.js'

describe('tokensOf', () => {
  it('reads plain digits', () => {
    expect(tokensOf('300000')).toBe(300_000)
  })

  it('reads thousands grouped by a comma, a dot or a space', () => {
    expect(tokensOf('300,000')).toBe(300_000)
    expect(tokensOf('30.000')).toBe(30_000)
    expect(tokensOf('3,000')).toBe(3_000)
    expect(tokensOf('1,000,000')).toBe(1_000_000)
    expect(tokensOf('300 000')).toBe(300_000)
    expect(tokensOf(' 250000 ')).toBe(250_000)
  })

  it('reads a k or m suffix, Latin or Cyrillic, any case, with a fraction', () => {
    expect(tokensOf('300k')).toBe(300_000)
    expect(tokensOf('300к')).toBe(300_000)
    expect(tokensOf('300 K')).toBe(300_000)
    expect(tokensOf('1.5k')).toBe(1_500)
    expect(tokensOf('1,1k')).toBe(1_100)
    expect(tokensOf('1m')).toBe(1_000_000)
    expect(tokensOf('1.2М')).toBe(1_200_000)
  })

  it('refuses what is no whole token count', () => {
    expect(tokensOf('')).toBeUndefined()
    expect(tokensOf('abc')).toBeUndefined()
    expect(tokensOf('1,5')).toBeUndefined()
    expect(tokensOf('30,00')).toBeUndefined()
    expect(tokensOf('1,000.000')).toBeUndefined()
    expect(tokensOf('1.2345k')).toBeUndefined()
    expect(tokensOf('-5')).toBeUndefined()
    expect(tokensOf('k')).toBeUndefined()
  })
})

describe('tokensShown', () => {
  it('groups plain digits by thousands', () => {
    expect(tokensShown('300000')).toBe('300,000')
    expect(tokensShown('3000')).toBe('3,000')
    expect(tokensShown('999')).toBe('999')
    expect(tokensShown('1000000')).toBe('1,000,000')
  })

  it('keeps anything else as typed', () => {
    expect(tokensShown('')).toBe('')
    expect(tokensShown('300k')).toBe('300k')
    expect(tokensShown('1.5')).toBe('1.5')
  })
})

describe('shownCaret', () => {
  it('puts the caret after as many digits of the grouped text', () => {
    expect(shownCaret('300000', 4)).toBe(5)
    expect(shownCaret('300000', 3)).toBe(3)
    expect(shownCaret('300000', 6)).toBe(7)
    expect(shownCaret('300k', 2)).toBe(2)
  })
})

describe('typedTokens', () => {
  it('drops the separators of a typed number, keeping the caret among its digits', () => {
    expect(typedTokens('30,0000', 7, '30000', null)).toEqual({ value: '300000', caret: 6 })
    expect(typedTokens('3000', 4, '300', null)).toEqual({ value: '3000', caret: 4 })
    expect(typedTokens('1,0500', 3, '1500', null)).toEqual({ value: '10500', caret: 2 })
  })

  it('regroups a grouped number as its digits are removed', () => {
    // "1,000,000", two Backspaces at the end: the browser leaves "1,000,0".
    expect(typedTokens('1,000,00', 8, '1000000', 'backward')).toEqual({ value: '100000', caret: 6 })
    expect(typedTokens('1,000,0', 7, '100000', 'backward')).toEqual({ value: '10000', caret: 5 })
    expect(typedTokens('1,00', 4, '1000', 'backward')).toEqual({ value: '100', caret: 3 })
    expect(typedTokens('1,00', 2, '1000', 'forward')).toEqual({ value: '100', caret: 1 })
  })

  it('keeps a fraction or a suffix being typed as it is', () => {
    expect(typedTokens('1.', 2, '1', null)).toEqual({ value: '1.', caret: 2 })
    expect(typedTokens('1.5', 3, '1.', null)).toEqual({ value: '1.5', caret: 3 })
    expect(typedTokens('1,5', 3, '1,', null)).toEqual({ value: '1,5', caret: 3 })
    expect(typedTokens('300k', 4, '300', null)).toEqual({ value: '300k', caret: 4 })
  })

  it('takes a backspace on a separator for the digit before it', () => {
    // "300,000" with the caret after the comma, Backspace: the browser leaves "300000" and the caret at 3.
    expect(typedTokens('300000', 3, '300000', 'backward')).toEqual({ value: '30000', caret: 2 })
  })

  it('takes a delete on a separator for the digit after it', () => {
    expect(typedTokens('300000', 3, '300000', 'forward')).toEqual({ value: '30000', caret: 3 })
  })
})
