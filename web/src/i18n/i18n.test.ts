import { afterEach, describe, expect, it } from 'vitest'
import { en } from './en.js'
import { language, localized, pickLanguage, setLanguage, t } from './index.js'
import { plural } from './plural.js'
import { ru } from './ru.js'

afterEach(() => setLanguage('en'))

describe('pickLanguage', () => {
  it('takes the configured language over the browser', () => {
    expect(pickLanguage('en', ['ru-RU'])).toBe('en')
    expect(pickLanguage('ru', ['en-US'])).toBe('ru')
  })

  it('takes the first browser language the page knows', () => {
    expect(pickLanguage(null, ['ru-RU', 'en'])).toBe('ru')
    expect(pickLanguage(null, ['uk', 'RU'])).toBe('ru')
    expect(pickLanguage(null, ['de-DE', 'en-GB', 'ru'])).toBe('en')
  })

  it('falls back to English', () => {
    expect(pickLanguage(null, [])).toBe('en')
    expect(pickLanguage(null, ['de', 'fr'])).toBe('en')
  })
})

describe('setLanguage', () => {
  it('switches the messages', () => {
    setLanguage('ru')
    expect(language).toBe('ru')
    expect(t).toBe(ru)
    setLanguage('en')
    expect(t).toBe(en)
  })

  it('rebuilds localized values when the language changes', () => {
    const made: string[] = []
    const value = localized((each) => {
      made.push(each)
      return each
    })
    expect(value()).toBe('en')
    expect(value()).toBe('en')
    setLanguage('ru')
    expect(value()).toBe('ru')
    expect(made).toEqual(['en', 'ru'])
  })
})

describe('plural', () => {
  it('picks the Russian form by the last digits', () => {
    const forms = { one: 'запуск', few: 'запуска', many: 'запусков', other: 'запуска' }
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112].map((count) => plural('ru', count, forms))).toEqual([
      'запусков',
      'запуск',
      'запуска',
      'запуска',
      'запусков',
      'запусков',
      'запусков',
      'запусков',
      'запуск',
      'запуска',
      'запусков',
      'запуск',
      'запусков',
      'запусков',
    ])
  })

  it('picks the English form', () => {
    expect([0, 1, 2].map((count) => plural('en', count, { one: 'run', other: 'runs' }))).toEqual(['runs', 'run', 'runs'])
  })

  it('counts with the dictionaries', () => {
    expect(ru.chain.tasks(3)).toBe('3 задачи')
    expect(en.chain.tasks(1)).toBe('1 task')
    expect(en.chain.tasks(3)).toBe('3 tasks')
  })
})
