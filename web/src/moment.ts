import type { Language } from '../../src/language.js'

/** A local reset time; retain legacy notices whose value was already formatted. */
export function localMoment(at: string, now: Date, language: Language): string {
  const moment = new Date(at)
  if (Number.isNaN(moment.getTime())) return at
  return new Intl.DateTimeFormat(language, {
    ...(moment.toDateString() === now.toDateString() ? {} : { day: 'numeric', month: 'short' }),
    hour: '2-digit', minute: '2-digit',
  }).format(moment)
}
