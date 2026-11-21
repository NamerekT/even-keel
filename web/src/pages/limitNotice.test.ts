import { afterEach, describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import { formatMoment } from '../format.js'
import { say, sayIds, setLanguage } from '../i18n/index.js'
import { limitMessage, spentHeld } from './limitMessages.js'
import { session } from '../live/fakeSessions.js'

afterEach(() => setLanguage('en'))

describe('limit notice on the page', () => {
  it('shows only the newest of the refusal, the agent report and the plan', () => {
    const view = { ...session('ABC-5', 0, 'limit'), apiError: 'Provider refusal', apiErrorKind: 'limit' as const, lastActivityAt: '2026-10-27T06:01:00Z' }
    const hold = { at: '2026-10-27T06:00:00Z', account: 'codex', resetsAt: '2026-10-27T07:00:00Z', lastReplyAt: null, then: 'relay' as const, acted: null }
    const refusal = { notice: notice('chain.limitSpent', { until: hold.resetsAt, account: 'Build account', provider: 'codex' }), at: '2026-10-27T06:02:00Z' }
    const now = new Date('2026-10-27T06:03:00Z')
    expect(limitMessage(hold, now, view, [], refusal)?.kind).toBe('refusal')
    expect(limitMessage(hold, now, view, [], null)).toEqual({ kind: 'agent', text: 'Provider refusal', at: view.lastActivityAt })
    expect(limitMessage(hold, now, { ...view, lastActivityAt: '2026-10-27T05:59:00Z' }, [], null)?.kind).toBe('plan')
    expect(limitMessage(null, now, { ...view, apiErrorKind: 'transient' as const }, [], null)).toBeUndefined()
  })
  it.each(['en', 'ru'] as const)('names the task account, its pool and a local reset in %s', (language) => {
    setLanguage(language)
    const until = '2026-10-27T06:54:09.000Z'
    const text = say(notice('chain.limitSpent', { until, account: 'Build account', provider: 'codex' }))
    if (language === 'en') {
      expect(text).toMatch(/^The usage limit is spent until /)
      expect(text).toContain('. Wait for the reset,')
      expect(text).toMatch(/\.$/)
    }
    expect(text).toContain('Build account')
    expect(text).toContain('Codex')
    expect(text).toContain(formatMoment(until, new Date()))
    expect(text).not.toContain(until)
    expect(text).toContain(language === 'en' ? 'pool' : 'пул')
    expect(text).toContain(language === 'en' ? 'card' : 'карточк')
    const nested = sayIds(notice('chain.empty', { project: 'ABC' }, { cause: notice('chain.limitSpent', { until }) }))
    expect(nested).toContain(formatMoment(until, new Date()))
    expect(nested).not.toContain(until)
  })

  it.each(['en', 'ru'] as const)('holds New session on a spent limit with the account as the red card names it in %s (BTN-1359)', (language) => {
    setLanguage(language)
    const spent = { until: '2026-10-27T06:54:09.000Z', account: 'Build account', provider: 'codex' }
    const card = say(notice('chain.limitSpent', spent))
    const tip = spentHeld(spent)
    expect(tip).toContain(formatMoment(spent.until, new Date()))
    expect(tip).toContain(language === 'en' ? 'on Codex account “Build account”' : 'на аккаунте Codex «Build account»')
    expect(card).toContain(language === 'en' ? 'on Codex account “Build account”' : 'на аккаунте Codex «Build account»')
    expect(tip).toContain(language === 'en' ? 'new session by itself' : 'сама передаст задачу новой сессии')
    expect(spentHeld(undefined)).toBeNull()
  })
})
