import { describe, expect, it } from 'vitest'
import type { AccountView } from '../account/model.js'
import type { RateLimits } from '../limits/model.js'
import { wireMachine } from './machine-chain.js'
import type { MachineContext } from './machine-context.js'

const UNTIL = '2026-09-26T23:00:00.000Z'
const spent = { fiveHour: { usedPercentage: 100, resetsAt: UNTIL }, sevenDay: null, updatedAt: '2026-09-26T20:00:00.000Z' } as unknown as RateLimits

function port(limits: Record<string, RateLimits | null>, sessionAccount: string | undefined) {
  const view = { active: 'codex-a', login: null, accounts: [{ key: 'codex-a', status: { loggedIn: true } }, { key: 'claude-b', status: { loggedIn: true } }] } as unknown as AccountView
  const ctx = {
    choiceFor: () => ({ account: 'claude-b', provider: 'claude', model: null }),
    monitor: { handoff: () => (sessionAccount === undefined ? undefined : { account: sessionAccount }) },
    limits: { limits: (key: string) => limits[key] ?? null },
    accountNow: (key: string) => ({ id: key, ready: true, label: `Label of ${key}`, provider: key.split('-')[0] }),
    account: { view },
  } as unknown as MachineContext
  return wireMachine(ctx, async () => {})
}

describe("the session's own account (BTN-1396)", () => {
  it('takes the answer while only the account selected for the next launch is spent', () => {
    const machine = port({ 'claude-b': spent }, 'codex-a')
    expect(machine.limitReset('ABC', 'ABC-1')).toBe(UNTIL)
    expect(machine.sessionBlock('ABC-1')).toBeUndefined()
  })

  it('refuses by its own spent limit and names it', () => {
    expect(port({ 'codex-a': spent }, 'codex-a').sessionBlock('ABC-1')).toEqual({
      code: 'chain.limitSpent',
      params: { until: UNTIL, account: 'Label of codex-a', provider: 'codex' },
    })
  })

  it('refuses when its folder is gone', () => {
    expect(port({}, 'gone-c').sessionBlock('ABC-1')?.code).toBe('account.homeGone')
  })

  it('has nothing to say without a session', () => {
    expect(port({ 'codex-a': spent }, undefined).sessionBlock('ABC-1')).toBeUndefined()
  })
})
