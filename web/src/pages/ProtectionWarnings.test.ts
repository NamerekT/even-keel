import { describe, expect, it } from 'vitest'
import type { EvenKeelState } from '../../../src/state.js'
import { DEFAULT_PROTECTION, PROTECTION_GROUPS, type Protection } from '../../../src/sessions/protection.js'
import { protectionAgents } from './ProtectionWarnings.js'
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
