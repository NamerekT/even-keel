import { noticesEn } from './notices-en.js'
import { noticesRu } from './notices-ru.js'

/**
 * The longest a server message may be on the page (EKR-87, `docs/web/language.md`), counted with every parameter as one
 * character: the limit is on the words, a path or a task name adds nothing. Russian runs about a tenth longer.
 */
export const NOTICE_LIMITS = { en: 200, ru: 220 } as const
export type NoticeLanguage = keyof typeof NOTICE_LIMITS

// Any parameter: prints as "1", counts as 1, iterates once, and any field or call of it is itself.
const stub: unknown = new Proxy(() => {}, {
  get: (_, key) =>
    key === Symbol.toPrimitive ? (hint: string) => (hint === 'number' ? 1 : '1')
    : key === Symbol.iterator ? function* () { yield stub }
    : key === 'length' ? 1
    : stub,
  apply: () => stub,
})
// The parameters a template looks a text up by, where the stub finds none.
const SAMPLES: Record<string, Record<string, unknown>> = { 'git.failed': { step: 'clean' }, 'eventLog.packages': { problem: 'noResponse' } }
const paramsOf = (code: string): unknown => new Proxy({}, { get: (_, key) => (typeof key === 'string' ? SAMPLES[code]?.[key] : undefined) ?? stub })

/** Each code's text length in each language. */
export function noticeLengths(): Record<NoticeLanguage, Record<string, number>> {
  const measure = (texts: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(texts).map(([code, render]) => [code, String((render as (params: unknown) => string)(paramsOf(code))).length]))
  return { en: measure(noticesEn), ru: measure(noticesRu) }
}

/** The texts longer than the limit, as `notice-lengths.json` holds them: the ones older than the rule. */
export function overLimit(lengths = noticeLengths()): Record<NoticeLanguage, Record<string, number>> {
  const over = (language: NoticeLanguage) =>
    Object.fromEntries(Object.entries(lengths[language]).filter(([, length]) => length > NOTICE_LIMITS[language]).sort(([a], [b]) => a.localeCompare(b)))
  return { en: over('en'), ru: over('ru') }
}
