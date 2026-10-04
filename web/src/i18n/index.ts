import { isLanguage, type Language } from '../../../src/language.js'
import { en } from './en.js'
import { ru, type Messages } from './ru.js'

export type { Messages }

const MESSAGES: Record<Language, Messages> = { en, ru }

export let language: Language = 'en'
export let t: Messages = en

export function setLanguage(next: Language): void {
  language = next
  t = MESSAGES[next]
  if (typeof document !== 'undefined') document.documentElement.lang = next
}

// The configured language wins; otherwise the first browser language the page knows, English if none.
export function pickLanguage(configured: Language | null, browser: readonly string[]): Language {
  if (configured !== null) return configured
  for (const tag of browser) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLanguage(base)) return base
  }
  return 'en'
}

// A formatter built for the current language and rebuilt when it changes.
export function localized<T>(make: (language: Language) => T): () => T {
  let cached: { language: Language; value: T } | null = null
  return () => {
    if (cached === null || cached.language !== language) cached = { language, value: make(language) }
    return cached.value
  }
}
