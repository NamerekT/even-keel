import { describe, expect, it } from 'vitest'
import type { Mail } from '../../../src/sessions/mail.js'
import { DELIVERED_FADE_MS, DELIVERED_SHOWN_MS, letterPhase, nextLetterChange } from './letterPhase.js'

const SETTLED = Date.parse('2026-10-18T15:47:00Z')

function mail(fate: Mail['fate'], settledAt: number | null = SETTLED): Mail {
  return {
    id: 1,
    task: 'ABC-5',
    sessionId: 's1',
    text: 'Hello',
    files: [],
    postedAt: new Date(SETTLED - 60_000).toISOString(),
    fate,
    event: fate === 'delivered' ? 'PostToolUse' : null,
    settledAt: settledAt === null ? null : new Date(settledAt).toISOString(),
  }
}

describe('letterPhase', () => {
  it('keeps a waiting or returned message whatever its age', () => {
    expect(letterPhase(mail('waiting', null), SETTLED + 3_600_000)).toBe('shown')
    expect(letterPhase(mail('returned'), SETTLED + 3_600_000)).toBe('shown')
  })

  it('shows a delivered message, fades it, then drops it', () => {
    expect(letterPhase(mail('delivered'), SETTLED + DELIVERED_SHOWN_MS - 1)).toBe('shown')
    expect(letterPhase(mail('delivered'), SETTLED + DELIVERED_SHOWN_MS)).toBe('leaving')
    expect(letterPhase(mail('delivered'), SETTLED + DELIVERED_SHOWN_MS + DELIVERED_FADE_MS)).toBe('gone')
  })

  it('keeps a message the page clock sees as delivered in the future', () => {
    expect(letterPhase(mail('delivered'), SETTLED - 5_000)).toBe('shown')
  })
})

describe('nextLetterChange', () => {
  it('is the nearest moment a delivered message changes its phase', () => {
    const later = { ...mail('delivered', SETTLED + 1_000), id: 2 }
    expect(nextLetterChange([mail('waiting', null), mail('delivered'), later], SETTLED + 500)).toBe(DELIVERED_SHOWN_MS - 500)
    expect(nextLetterChange([mail('delivered')], SETTLED + DELIVERED_SHOWN_MS + 100)).toBe(DELIVERED_FADE_MS - 100)
  })

  it('is null when nothing is going to change', () => {
    expect(nextLetterChange([mail('waiting', null), mail('returned')], SETTLED)).toBeNull()
    expect(nextLetterChange([mail('delivered')], SETTLED + 60_000)).toBeNull()
  })
})
