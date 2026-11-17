import { describe, expect, it } from 'vitest'
import type { EvenKeelState } from '../../../src/state.js'
import { DEFAULT_PROTECTION, PROTECTION_GROUPS, type Protection } from '../../../src/sessions/protection.js'
import { planProtectionWarnings, protectionAgents, protectionShown, remoteProtectionWarnings } from './ProtectionWarnings.js'
import { protectionOf, protectionText } from './protectionDraft.js'

const stateWith = (protection: Protection) => ({
  config: { shared: { provider: 'opencode', protection }, projects: {} }, tasks: [], sessions: [],
}) as unknown as EvenKeelState

describe('OpenCode Protection on the page', () => {
  it('warns only when command and tracker rules are all absent', () => {
    const empty = { ...DEFAULT_PROTECTION, disabled: [...PROTECTION_GROUPS] }
    expect(protectionAgents(stateWith(DEFAULT_PROTECTION), 'p')).toEqual([])
    expect(protectionAgents(stateWith(empty), 'p')).toEqual(['opencode'])
    expect(protectionAgents(stateWith({ ...empty, opencode: ['terraform destroy*'] }), 'p')).toEqual([])
    expect(protectionAgents(stateWith({ ...empty, disabled: empty.disabled.filter(group => group !== 'deleteHuly') }), 'p')).toEqual([])
  })

  it('round trips multiline OpenCode patterns through the editor', () => {
    const protection = { ...DEFAULT_PROTECTION, opencode: ['git reset --hard*', 'terraform destroy?'] }
    expect(protectionOf(protectionText(protection))).toEqual(protection)
  })
})

describe('a plan without branch protection (EKR-121)', () => {
  const url = 'https://github.com/example/demo/settings/rules'
  const stateOf = (dismissed: Record<string, string>, notices: Record<string, boolean> = {}) => ({
    config: { shared: { provider: 'claude', protection: DEFAULT_PROTECTION, notices }, projects: { p: {} } }, tasks: [], sessions: [],
    protection: { p: [{ remote: 'github', branch: 'main', status: 'unavailable', bypass: false, url }] },
    noticesDismissed: dismissed,
  }) as unknown as EvenKeelState

  it('has its own band, apart from the access warnings', () => {
    expect(remoteProtectionWarnings(stateOf({}), 'p')).toEqual([])
    expect(planProtectionWarnings(stateOf({}), 'p').map(item => item.remote)).toEqual(['github'])
    expect(protectionShown(stateOf({}), 'p')).toBe(true)
  })

  it('stays closed for the repository and branch it was closed for', () => {
    expect(protectionShown(stateOf({ [`protection.plan:${url}@p`]: 'main' }), 'p')).toBe(false)
    expect(protectionShown(stateOf({ [`protection.plan:${url}@p`]: 'develop' }), 'p')).toBe(true)
  })

  it('goes with the remote protection kind turned off', () => {
    expect(protectionShown(stateOf({}, { 'protection.remote': false }), 'p')).toBe(false)
  })
})
