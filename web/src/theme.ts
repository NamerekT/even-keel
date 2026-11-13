import { useSyncExternalStore } from 'react'

export const THEME_CHOICES = ['system', 'light', 'dark'] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]
export type Theme = 'light' | 'dark'

/**
 * The page's theme, kept per browser and not in the config: a phone and a desktop may want different ones (BTN-1089).
 * The inline script of `index.html` reads the same key and sets `data-theme` before the first paint.
 */
export const THEME_KEY = 'even-keel.theme'
const DARK = '(prefers-color-scheme: dark)'

export function parseThemeChoice(value: string | null): ThemeChoice {
  return THEME_CHOICES.find((choice) => choice === value) ?? 'system'
}

export function themeOf(choice: ThemeChoice, systemDark: boolean): Theme {
  if (choice === 'system') return systemDark ? 'dark' : 'light'
  return choice
}

/**
 * The `media` of a `theme-color` meta of `scheme`: the system's own query while the choice is the system's, otherwise
 * the chosen theme's meta matches always and the other never, so a phone's browser bar follows the choice too.
 */
export function themeColorMedia(scheme: Theme, choice: ThemeChoice, theme: Theme): string {
  if (choice === 'system') return `(prefers-color-scheme: ${scheme})`
  return scheme === theme ? 'all' : 'not all'
}

const listeners = new Set<() => void>()
let current: ThemeChoice = 'system'

function readChoice(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(THEME_KEY))
  } catch {
    return 'system'
  }
}

function applyTheme() {
  const theme = themeOf(current, matchMedia(DARK).matches)
  document.documentElement.dataset.theme = theme
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][data-scheme]')) {
    const scheme = meta.dataset.scheme === 'dark' ? 'dark' : 'light'
    meta.media = themeColorMedia(scheme, current, theme)
  }
}

function changed(next: ThemeChoice) {
  current = next
  applyTheme()
  for (const listener of listeners) listener()
}

/** Called once before the first render: applies the kept choice and follows the system's theme and other tabs on the fly. */
export function watchTheme() {
  current = readChoice()
  applyTheme()
  matchMedia(DARK).addEventListener('change', applyTheme)
  addEventListener('storage', (event) => {
    if (event.key === THEME_KEY || event.key === null) changed(readChoice())
  })
}

export function setThemeChoice(next: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {}
  changed(next)
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}
