import { afterEach, describe, expect, it } from 'vitest'
import { en } from './en.js'
import { en as serverEn } from '../../../src/notice/en.js'
import { asNotice, notice } from '../../../src/notice/notice.js'
import { noticesRu } from './notices-ru.js'
import { fieldsEn } from './fields-en.js'
import { fieldsRu } from './fields-ru.js'
import { language, localized, pickLanguage, say, sayAtField, setLanguage, t } from './index.js'
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

describe('say', () => {
  const failed = notice('cleanup.syncFailed', {}, { cause: notice('sync.push', { remote: 'origin', main: 'master' }, { detail: 'rejected' }) })

  it('puts a server message into the page language, keeping the output of git as it is', () => {
    setLanguage('ru')
    expect(say(failed)).toBe('синхронизация главной ветки не удалась: не удалось отправить master в origin: rejected')
    setLanguage('en')
    expect(say(failed)).toBe('sync of the main branch failed: could not push master to origin: rejected')
  })

  it('shows a message saved as plain text before codes as it is', () => {
    setLanguage('ru')
    expect(say(asNotice('ABC-0: the worktree was kept'))).toBe('ABC-0: the worktree was kept')
  })
})

describe('sayAtField', () => {
  const branch = notice('config.branch', { where: 'id-abc.branch', value: '"a..b"' })

  it('says a setting refused at its field by the value, without the path of the config (BTN-297)', () => {
    expect(sayAtField(branch)).toBe('"a..b" is not a branch name')
    setLanguage('ru')
    expect(sayAtField(branch)).toBe('"a..b" — не имя ветки')
    expect(sayAtField(notice('config.statusBoth', { project: 'id-abc', status: 'Done' }))).toBe('«Done» стоит и в «Статусы в работе», и в «Закрытые статусы»')
  })

  it('names no path of the config in any text at a field', () => {
    for (const texts of [fieldsEn, fieldsRu]) for (const render of Object.values(texts)) expect(String(render)).not.toMatch(/\bwhere\b|projects\[/)
  })

  it('names no path or key of the config in the texts of "Add a project"', () => {
    const leaves = (value: unknown): unknown[] => (typeof value === 'object' && value !== null ? Object.values(value).flatMap(leaves) : [value])
    const server = [...Object.entries(serverEn), ...Object.entries(noticesRu)].filter(([code]) => code.startsWith('wizard.')).map(([, render]) => render)
    // The parameters of a text (`p.key`) are values, not paths.
    for (const text of [...server, ...leaves(en.wizard), ...leaves(ru.wizard)])
      expect(String(text).replace(/\bp\.\w+/g, '')).not.toMatch(/\bwhere\b|projects\[|\.key\b|\bchain\.\w|trackerProject|mergeInto/)
  })

  it('says what has no text at a field as the server does', () => {
    const other = notice('config.feedPlace', { project: 'ABC', other: 'DEF' })
    expect(sayAtField(other)).toBe(say(other))
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
