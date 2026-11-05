import { describe, expect, it } from 'vitest'
import baselineText from './notice-lengths.json?raw'
import { NOTICE_LIMITS, noticeLengths, overLimit, type NoticeLanguage } from './noticeLength.js'

describe('the length of server messages (docs/web/language.md, "Short messages")', () => {
  const baseline = JSON.parse(baselineText) as Record<NoticeLanguage, Record<string, number>>
  const lengths = noticeLengths()
  const languages = Object.keys(NOTICE_LIMITS) as NoticeLanguage[]

  it('measures every code of both languages', () => {
    for (const language of languages) {
      expect(Object.keys(lengths[language]).length).toBeGreaterThan(400)
      expect(Object.values(lengths[language]).every((length) => length > 0)).toBe(true)
    }
  })

  it('no text is longer than the limit or, for the older ones, than its baseline length', () => {
    const longer = languages.flatMap((language) => Object.entries(lengths[language])
      .filter(([code, length]) => length > Math.max(NOTICE_LIMITS[language], baseline[language][code] ?? 0))
      .map(([code, length]) => `${language} ${code}: ${length}, the limit is ${baseline[language][code] ?? NOTICE_LIMITS[language]}`))
    expect(longer, 'Say what happened and what to do in one or two sentences; the why goes into a tip or the log').toEqual([])
  })

  it('the baseline is not above what is left: a length there may only go down', () => {
    const now = overLimit(lengths)
    const shorter = languages.flatMap((language) => Object.entries(baseline[language])
      .filter(([code, length]) => (now[language][code] ?? 0) < length)
      .map(([code, length]) => `${language} ${code}: ${lengths[language][code] ?? 'gone'}, the baseline says ${length}`))
    expect(shorter, 'Run `npm run notice-lengths` and commit web/src/i18n/notice-lengths.json').toEqual([])
  })
})
