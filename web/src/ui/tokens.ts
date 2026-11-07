/** A token count as a person types it: `300000`, `300,000`, `30.000`, `300 000`, `300k`, `300к`, `1.5k`, `1m`. */

const SPACES = /[\s  ]/g
const SEPARATOR = /[.,\s  ]/
/** Digits whose separators only group thousands, or are about to: each one has three digits or more after it. */
const GROUPED = /^\d+(?:[.,\s  ]\d{3,})*$/

/** The whole count; `undefined` — the text is no count. The caller judges the range. */
export function tokensOf(text: string): number | undefined {
  const plain = text.replace(SPACES, '').toLowerCase()
  const suffixed = /^(\d+(?:[.,]\d+)?)([kкmм])$/.exec(plain)
  if (suffixed !== null) {
    const value = Number(suffixed[1]!.replace(',', '.')) * ('kк'.includes(suffixed[2]!) ? 1_000 : 1_000_000)
    const whole = Math.round(value)
    return Math.abs(value - whole) < 1e-6 ? whole : undefined
  }
  if (/^\d+$/.test(plain) || /^\d{1,3}(?:,\d{3})+$/.test(plain) || /^\d{1,3}(?:\.\d{3})+$/.test(plain)) return Number(plain.replace(/[.,]/g, ''))
  return undefined
}

/** A count from `min` on for a field that may stay empty: empty — `null`, `undefined` — no such count. */
export function countFrom(text: string, min: number): number | null | undefined {
  if (text.trim() === '') return null
  const count = tokensOf(text)
  return count !== undefined && count >= min ? count : undefined
}

/** Plain digits grouped by thousands with a comma; anything else as typed. */
export function tokensShown(value: string): string {
  return /^\d+$/.test(value) ? value.replace(/\B(?=(\d{3})+$)/g, ',') : value
}

/** The caret in the shown text for a caret among the value's characters. */
export function shownCaret(value: string, caret: number): number {
  if (!/^\d+$/.test(value)) return caret
  const shown = tokensShown(value)
  let digits = 0
  for (let index = 0; index < shown.length; index++) {
    if (digits === caret) return index
    if (shown[index] !== ',') digits++
  }
  return shown.length
}

/**
 * What a typed text keeps, given the value before the edit: a number grouped by thousands — or one that was shown
 * grouped and lost a digit — loses its separators, the caret staying among the same digits; a fraction or a suffix
 * being typed stays as it is. A Backspace or Delete that took only a shown separator takes the digit beside it
 * instead, or the separator would come straight back.
 */
export function typedTokens(raw: string, caret: number, previous: string, removed: 'backward' | 'forward' | null): { value: string; caret: number } {
  const shown = tokensShown(previous)
  let text = raw
  let at = caret
  const tookSeparator =
    removed !== null && shown.length === raw.length + 1 && SEPARATOR.test(shown[caret] ?? '') && shown.slice(0, caret) + shown.slice(caret + 1) === raw
  if (tookSeparator && removed === 'backward' && at > 0) {
    text = raw.slice(0, at - 1) + raw.slice(at)
    at -= 1
  } else if (tookSeparator && removed === 'forward') {
    text = raw.slice(0, at) + raw.slice(at + 1)
  }
  const wasGrouped = /^\d{4,}$/.test(previous)
  const regroup = /\d/.test(text) && /^[\d.,\s  ]+$/.test(text) && (GROUPED.test(text) || wasGrouped)
  if (!regroup) return { value: text, caret: at }
  return { value: text.replace(/\D/g, ''), caret: text.slice(0, at).replace(/\D/g, '').length }
}
