import type { Mail } from '../../../src/sessions/mail.js'

/** How long a delivered message keeps its line: the feed shows it as the user's prompt by then. */
export const DELIVERED_SHOWN_MS = 3_000
/** How long the line of a delivered message takes to fade and fold. */
export const DELIVERED_FADE_MS = 300

export type LetterPhase = 'shown' | 'leaving' | 'gone'

function deliveredAge(mail: Mail, now: number): number | null {
  return mail.fate === 'delivered' ? now - Date.parse(mail.settledAt ?? mail.postedAt) : null
}

/** Where a message's line is at `now`: only a delivered one goes, a waiting or returned one stays until its fate changes. */
export function letterPhase(mail: Mail, now: number): LetterPhase {
  const age = deliveredAge(mail, now)
  if (age === null || age < DELIVERED_SHOWN_MS) return 'shown'
  return age < DELIVERED_SHOWN_MS + DELIVERED_FADE_MS ? 'leaving' : 'gone'
}

/** Milliseconds until the next line changes its phase, or `null` when none is going to. */
export function nextLetterChange(mail: Mail[], now: number): number | null {
  const waits = mail.flatMap((each) => {
    const age = deliveredAge(each, now)
    if (age === null) return []
    return [DELIVERED_SHOWN_MS - age, DELIVERED_SHOWN_MS + DELIVERED_FADE_MS - age].filter((wait) => wait > 0).slice(0, 1)
  })
  return waits.length === 0 ? null : Math.min(...waits)
}
