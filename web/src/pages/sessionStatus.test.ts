import { afterEach, describe, expect, it } from 'vitest'
import type { LimitHold } from '../../../src/chain/relay.js'
import { setLanguage, t } from '../i18n/index.js'
import { fakeAccount, FAKE_LIMITS } from '../live/fakeAccounts.js'
import { session } from '../live/fakeSessions.js'
import { limitPlan, sessionStatus } from './sessionStatus.js'

const now = new Date('2026-01-01T12:00:00Z')
const hold: LimitHold = { at: now.toISOString(), account: 'ci-key', resetsAt: null, lastReplyAt: null, then: 'relay', acted: null }
const accounts = fakeAccount('api', false, FAKE_LIMITS).accounts

afterEach(() => setLanguage('en'))

describe('session limit text', () => {
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

  it.each(['en', 'ru'] as const)('distinguishes credit from usage limits in %s', (language) => {
    setLanguage(language)
    const view = { ...session('ABC-5', 0, 'limit'), apiErrorKind: 'credit' as const }
    expect(sessionStatus(view)).toBe(language === 'en' ? 'out of credit' : 'кончился кредит')
    expect(sessionStatus({ ...view, apiErrorKind: 'limit' })).toBe(t.lamp.limit)
    expect(sessionStatus({ ...view, lamp: 'working' })).toBe(t.lamp.working)
  })
})
