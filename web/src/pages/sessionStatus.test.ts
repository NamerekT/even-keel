import { afterEach, describe, expect, it } from 'vitest'
import type { LimitHold } from '../../../src/chain/relay.js'
import { setLanguage, t } from '../i18n/index.js'
import { fakeAccount, FAKE_LIMITS } from '../live/fakeAccounts.js'
import { session } from '../live/fakeSessions.js'
import { limitPlan, sessionStatus } from './sessionStatus.js'
import { formatMoment } from '../format.js'

const now = new Date('2026-01-01T12:00:00Z')
const hold: LimitHold = { at: now.toISOString(), account: 'ci-key', resetsAt: null, lastReplyAt: null, then: 'relay', acted: null }
const accounts = fakeAccount('api', false, FAKE_LIMITS).accounts

afterEach(() => setLanguage('en'))

describe('session limit text', () => {
  it.each(['en', 'ru'] as const)('shows a temporary refusal and its next retry in %s', (language) => {
    setLanguage(language)
    const view = { ...session('ABC-5', 0, 'waiting'), apiErrorKind: 'transient' as const }
    expect(sessionStatus(view)).toBe(language === 'en' ? 'waiting to retry' : 'ждёт повтора')
    const plan = limitPlan({ ...hold, resetsAt: '2026-01-01T12:15:00Z', then: 'resume' }, now, view, accounts)
    expect(plan).toContain(formatMoment('2026-01-01T12:15:00Z', now))
    expect(plan).toContain(language === 'en' ? 'same session' : 'эту же сессию')
    expect(sessionStatus({ ...view, lamp: 'working' })).toBe(t.lamp.working)
  })
  it.each(['en', 'ru'] as const)('does not ask for a reply while the tracker refuses closure (%s)', (language) => {
    setLanguage(language)
    const view = { ...session('ABC-5', 0, 'waiting'), asking: false, ask: null }
    expect(sessionStatus(view, true)).toBe(language === 'en' ? 'tracker refused closure' : 'трекер не даёт закрыть')
    expect(sessionStatus({ ...view, asking: true }, true)).toBe(t.lamp.waiting)
  })
  it.each(['claude', 'codex', 'opencode', 'copilot'])('uses the %s session account to recognize a key without Remote Control', (agent) => {
    const view = { ...session('ABC-5', 0, 'limit'), agent, account: 'ci-key', remoteOff: null }
    expect(limitPlan(hold, now, view, accounts)).toBe(t.session.creditOut)
  })

  it('keeps a known monthly reset for a Copilot key', () => {
    const view = { ...session('ABC-5', 0, 'limit'), agent: 'copilot', account: 'ci-key' }
    const monthly = { ...hold, resetsAt: '2026-02-01T00:00:00Z' }
    expect(limitPlan(monthly, now, view, accounts)).toContain('After the limit resets')
    expect(limitPlan({ ...monthly, then: 'resume' }, now, view, accounts)).toContain('continues this session')
  })

  it('does not use another account or Remote Control as proof of an API key', () => {
    for (const account of ['global', 'missing', null]) {
      const view = { ...session('ABC-5', 0, 'limit'), account, remoteOff: 'api-key' as const }
      expect(limitPlan(hold, now, view, accounts)).toBe(t.session.limitUnknown)
    }
  })

  it.each(['en', 'ru'] as const)('describes the spending cap, its reset and early checks in %s', (language) => {
    setLanguage(language)
    const view = { ...session('ABC-5', 0, 'limit'), apiErrorKind: 'spend' as const, account: 'ci-key' }
    expect(sessionStatus(view)).toBe(language === 'en' ? 'spending limit' : 'лимит трат')
    expect(limitPlan(hold, now, view, accounts)).toBe(t.session.spendWait(null))
    const plan = limitPlan({ ...hold, resetsAt: '2026-11-01T00:00:00Z' }, now, view, accounts)
    expect(plan).toContain(language === 'en' ? 'Nov 1' : '1 нояб.')
    expect(plan).toContain('5')
    expect(sessionStatus({ ...view, lamp: 'working' })).toBe(t.lamp.working)
  })

  it.each(['en', 'ru'] as const)('distinguishes credit from usage limits in %s', (language) => {
    setLanguage(language)
    const view = { ...session('ABC-5', 0, 'limit'), apiErrorKind: 'credit' as const }
    expect(sessionStatus(view)).toBe(language === 'en' ? 'out of credit' : 'кончился кредит')
    expect(sessionStatus({ ...view, apiErrorKind: 'limit' })).toBe(t.lamp.limit)
    expect(sessionStatus({ ...view, lamp: 'working' })).toBe(t.lamp.working)
  })
})
