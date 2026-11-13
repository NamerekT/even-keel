import { describe, expect, it } from 'vitest'
import html from '../index.html?raw'
import script from '../public/theme.js?raw'
import { parseThemeChoice, THEME_KEY, themeColorMedia, themeOf } from './theme.js'

describe('parseThemeChoice', () => {
  it('takes a known choice and falls back to the system for anything else', () => {
    expect(parseThemeChoice('light')).toBe('light')
    expect(parseThemeChoice('dark')).toBe('dark')
    expect(parseThemeChoice('system')).toBe('system')
    expect(parseThemeChoice(null)).toBe('system')
    expect(parseThemeChoice('Dark')).toBe('system')
  })
})

describe('themeOf', () => {
  it('follows the system only when the choice is the system', () => {
    expect(themeOf('system', true)).toBe('dark')
    expect(themeOf('system', false)).toBe('light')
    expect(themeOf('light', true)).toBe('light')
    expect(themeOf('dark', false)).toBe('dark')
  })
})

describe('themeColorMedia', () => {
  it('keeps the system query for the system choice and pins the chosen one otherwise', () => {
    expect(themeColorMedia('dark', 'system', 'light')).toBe('(prefers-color-scheme: dark)')
    expect(themeColorMedia('dark', 'dark', 'dark')).toBe('all')
    expect(themeColorMedia('light', 'dark', 'dark')).toBe('not all')
  })
})

describe('the theme script index.html loads before the first paint', () => {
  it('is a blocking script of the page’s own origin, before any stylesheet or module', () => {
    const tag = html.indexOf('<script src="/theme.js"></script>')
    expect(tag).toBeGreaterThan(0)
    expect(tag).toBeLessThan(html.indexOf('</head>'))
    expect(html.indexOf('<script type="module"')).toBeGreaterThan(tag)
  })

  const run = (stored: string | null, systemDark: boolean, storageFails = false) => {
    const root = { dataset: {} as Record<string, string> }
    const storage = {
      getItem: (key: string) => {
        if (storageFails) throw new Error('blocked')
        return key === THEME_KEY ? stored : null
      },
    }
    const matchMedia = (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && systemDark })
    new Function('localStorage', 'matchMedia', 'document', script)(storage, matchMedia, { documentElement: root })
    return root.dataset.theme
  }

  it('sets the same theme as the page will', () => {
    for (const stored of [null, 'system', 'light', 'dark', 'junk'])
      for (const systemDark of [true, false]) expect(run(stored, systemDark)).toBe(themeOf(parseThemeChoice(stored), systemDark))
  })

  it('follows the system when the storage cannot be read', () => {
    expect(run('light', true, true)).toBe('dark')
  })
})
