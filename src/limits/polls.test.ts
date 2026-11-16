import { describe, expect, it } from 'vitest'
import type { RateLimits } from './model.js'
import { AccountPolls, type AccountTie, type MachineAccounts } from './polls.js'

const HUB = 'hub'
const tie = (account: string, over: Partial<AccountTie> = {}): AccountTie => ({ account, email: `${account}@example.com`, polls: true, ...over })
const limits = (at: string, used = 10): RateLimits => ({
  fiveHour: { usedPercentage: used, resetsAt: '2099-01-01T00:00:00.000Z' },
  sevenDay: null,
  updatedAt: at,
  source: 'usage',
})
const machine = (id: string, identities: Record<string, AccountTie>, over: Partial<MachineAccounts> = {}): MachineAccounts => ({
  machine: id,
  online: true,
  identities,
  limits: {},
  ...over,
})

function pollsOf() {
  const lines: string[] = []
  const polls = new AccountPolls({ hub: () => HUB, log: (line) => lines.push(line) })
  return { polls, lines }
}

describe('AccountPolls', () => {
  it('tells nothing to a hub that is the only machine', () => {
    const { polls } = pollsOf()
    expect(polls.plan([machine(HUB, { global: tie('a') })])).toEqual(new Map())
    expect(polls.poller('a')).toBe(HUB)
  })

  it('has the hub poll an account signed in on it, and the other machines skip their folder of it', () => {
    const { polls } = pollsOf()
    const plans = polls.plan([machine('m1', { work: tie('a'), own: tie('b') }), machine(HUB, { global: tie('a') })])
    expect(polls.poller('a')).toBe(HUB)
    expect(polls.poller('b')).toBe('m1')
    expect(plans).toEqual(new Map([['m1', { skip: ['work'] }]]))
  })

  it('names one machine when the hub has no full sign-in of the account, and keeps it while it is on the link', () => {
    const { polls, lines } = pollsOf()
    const hub = machine(HUB, { global: tie('a', { polls: false }) })
    expect(polls.plan([hub, machine('m2', { x: tie('a') }), machine('m1', { y: tie('a') })])).toEqual(
      new Map([['m2', { skip: ['x'] }]]),
    )
    expect(polls.poller('a')).toBe('m1')
    expect(lines.some((line) => line.includes('a@example.com') && line.includes('m1'))).toBe(true)
    // m0 sorts first, but the named machine stays while it is online.
    expect(polls.plan([hub, machine('m0', { z: tie('a') }), machine('m1', { y: tie('a') }), machine('m2', { x: tie('a') })])).toEqual(
      new Map([['m0', { skip: ['z'] }]]),
    )
    expect(polls.poller('a')).toBe('m1')
  })

  it('names another machine once the one polling went off the link', () => {
    const { polls } = pollsOf()
    polls.plan([machine('m1', { y: tie('a') }), machine('m2', { x: tie('a') })])
    const plans = polls.plan([machine('m1', { y: tie('a') }, { online: false }), machine('m2', { x: tie('a', { skipped: true }) })])
    expect(polls.poller('a')).toBe('m2')
    expect(plans).toEqual(new Map([['m2', { skip: [] }]]))
  })

  it('leaves an account no machine can poll without a poller, and nobody skips it', () => {
    const { polls } = pollsOf()
    expect(polls.plan([machine('m1', { y: tie('a', { polls: false }) }), machine('m2', { x: tie('a', { polls: false }) })])).toEqual(new Map())
    expect(polls.poller('a')).toBeUndefined()
  })

  it('hands a machine the newer limits another machine told of the same account, once', () => {
    const { polls } = pollsOf()
    const older = limits('2026-11-16T10:00:00.000Z')
    const newer = limits('2026-11-16T10:05:00.000Z', 30)
    const at = (hubLimits: RateLimits, m1Limits: RateLimits) => [
      machine(HUB, { global: tie('a') }, { limits: { global: hubLimits } }),
      machine('m1', { work: tie('a', { skipped: true }) }, { limits: { work: m1Limits } }),
    ]
    expect(polls.plan(at(newer, older))).toEqual(new Map([['m1', { picture: { work: newer } }]]))
    expect(polls.plan(at(newer, older))).toEqual(new Map())
    // What the machine posts back with the same time is no news for the hub.
    expect(polls.plan(at(newer, newer))).toEqual(new Map())
    const newest = limits('2026-11-16T10:10:00.000Z', 40)
    expect(polls.plan(at(newest, newer))).toEqual(new Map([['m1', { picture: { work: newest } }]]))
  })

  it('tells a machine everything again after it connected anew', () => {
    const { polls } = pollsOf()
    const told = limits('2026-11-16T10:05:00.000Z')
    const state = [machine(HUB, { global: tie('a') }, { limits: { global: told } }), machine('m1', { work: tie('a') })]
    polls.plan(state)
    polls.connected('m1')
    expect(polls.plan(state)).toEqual(new Map([['m1', { skip: ['work'], picture: { work: told } }]]))
  })

  it('takes a reconnected machine at its word for what it skips', () => {
    const { polls } = pollsOf()
    expect(polls.plan([machine(HUB, { global: tie('a') }), machine('m1', { work: tie('a', { skipped: true }) })])).toEqual(new Map())
  })

  it('tells nothing to a machine off the link', () => {
    const { polls } = pollsOf()
    expect(polls.plan([machine(HUB, { global: tie('a') }), machine('m1', { work: tie('a') }, { online: false })])).toEqual(new Map())
  })

  it('warns once that an account signed in on two machines shares its limit window', () => {
    const { polls, lines } = pollsOf()
    const state = [machine(HUB, { global: tie('a') }), machine('m1', { work: tie('a'), own: tie('b') })]
    polls.plan(state)
    polls.plan(state)
    expect(lines.filter((line) => line.includes('share one limit window'))).toHaveLength(1)
    expect(polls.shared()).toEqual([{ account: 'a', email: 'a@example.com', machines: ['hub', 'm1'] }])
  })
})
