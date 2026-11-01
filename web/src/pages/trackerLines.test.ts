import { describe, expect, it } from 'vitest'
import { textNotice } from '../../../src/notice/notice.js'
import type { ProfileView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { profileLine, projectLine } from './trackerLines.js'

const NOW = Date.parse('2026-11-01T12:00:00Z')

function profile(change: Partial<ProfileView>): ProfileView {
  return { login: null, expiresAt: null, check: { state: 'unchecked', error: null, at: null }, ...change } as ProfileView
}

describe('the strip under the profile', () => {
  it('says whom the profile signs in as, the login alone when the field is narrow', () => {
    const line = profileLine(profile({ login: 'john.doe@example.com', check: { state: 'ok', error: null, at: null } }), NOW)
    expect(line).toEqual({ tone: 'ok', text: t.wizard.signedIn('john.doe@example.com'), short: 'john.doe@example.com' })
  })

  it('says only that it signs in when the tracker names nobody', () => {
    expect(profileLine(profile({ check: { state: 'ok', error: null, at: null } }), NOW)).toEqual({ tone: 'ok', text: t.profiles.states.ok })
  })

  it('tells an expired token before anything else', () => {
    const expired = profile({ login: 'john.doe@example.com', expiresAt: '2026-10-30T00:00:00Z', check: { state: 'ok', error: null, at: null } })
    expect(profileLine(expired, NOW)).toEqual({ tone: 'error', text: t.profiles.expires(0) })
  })

  it('gives the reason of a refused or unreachable profile as an error', () => {
    const refused = profile({ check: { state: 'refused', error: textNotice('401 Unauthorized'), at: null } })
    expect(profileLine(refused, NOW)).toEqual({ tone: 'error', text: '401 Unauthorized' })
  })

  it('names a check under way plainly', () => {
    expect(profileLine(profile({ check: { state: 'checking', error: null, at: null } }), NOW)).toEqual({ tone: 'plain', text: t.profiles.states.checking })
  })
})

describe('the strip under the tracker project', () => {
  const none = { absent: null, alert: null, status: null, name: null, quiet: false }

  it('names the project the typed value is', () => {
    expect(projectLine({ ...none, name: 'Example app' })).toEqual({ tone: 'plain', text: 'Example app' })
  })

  it('puts a missing project and a failed list before the name and the check', () => {
    const status = { tone: 'ok' as const, text: 'The tracker answered: 3 open tasks' }
    expect(projectLine({ ...none, absent: 'Huly has no project ABQ', status, name: 'Example app' })).toEqual({ tone: 'error', text: 'Huly has no project ABQ' })
    expect(projectLine({ ...none, alert: 'no answer', status, name: 'Example app' })).toEqual({ tone: 'error', text: 'no answer' })
  })

  it("puts the check's answer before the name", () => {
    const status = { tone: 'ok' as const, text: 'The tracker answered: 3 open tasks', short: '3 open tasks' }
    expect(projectLine({ ...none, status, name: 'Example app' })).toBe(status)
  })

  it('says the suggestions did not load only when nothing else has a word', () => {
    expect(projectLine({ ...none, quiet: true, name: 'Example app' })).toEqual({ tone: 'plain', text: 'Example app' })
    expect(projectLine({ ...none, quiet: true })).toEqual({ tone: 'plain', text: t.wizard.suggestionsFailed })
    expect(projectLine(none)).toBeNull()
  })
})
