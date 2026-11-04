import { afterEach, describe, expect, it } from 'vitest'
import { setLanguage } from '../i18n/index.js'
import { windowValue } from './Limits.js'

const window = { usedPercentage: 4, resetsAt: '2026-12-01T00:00:00.000Z' }

describe('windowValue', () => {
  afterEach(() => setLanguage('en'))

  it('gives a counted allowance in a narrow column as the bare number, the word stays in the full form', () => {
    setLanguage('ru')
    expect(windowValue({ ...window, left: 192 }, 4, true)).toBe('192')
    expect(windowValue({ ...window, left: 192 }, 4)).toBe('осталось 192')
    setLanguage('en')
    expect(windowValue({ ...window, left: 192 }, 4, true)).toBe('192')
  })

  it('keeps the word for a spent count of unknown size, so it is not read as what is left', () => {
    setLanguage('ru')
    expect(windowValue({ ...window, used: 12 }, 4, true)).toBe('исп. 12')
  })
})
