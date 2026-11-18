import { describe, expect, it } from 'vitest'
import type { AccountEntry, AccountView } from '../../src/account/model.js'
import type { RateLimits } from '../../src/limits/model.js'
import type { MachineCard, MachineCardAccount } from '../../src/state.js'
import { headerAccounts } from './headerAccounts.js'

const limits = (used: number) => ({ fiveHour: { usedPercentage: used, resetsAt: null }, sevenDay: null, updatedAt: '', source: 'usage' }) as unknown as RateLimits

const account = (key: string, patch: Partial<MachineCardAccount> = {}): MachineCardAccount => ({
  key, agent: 'claude', email: `${key}@example.com`, signedIn: true, name: null, limits: null, ...patch,
})

const card = (id: string, patch: Partial<MachineCard> = {}): MachineCard => ({
  id, name: `Example ${id}`, color: '#7a8fa6', own: id === 'pc', online: true, offlineSince: null, gitUser: true, agents: ['claude'],
  limitedUntil: {}, projects: [], accounts: [], active: null, ...patch,
})

const entry = (key: string): AccountEntry => ({ key, agent: 'claude', status: { loggedIn: true, email: `${key}@example.com` } }) as unknown as AccountEntry

const view = (patch: Partial<AccountView> = {}): AccountView =>
  ({ active: 'john', accounts: [entry('john'), entry('jane')], pool: [], ...patch }) as unknown as AccountView

describe('headerAccounts', () => {
  it('gives one block per account Even Keel uses, its limits once and every machine it is signed in on', () => {
    const cards = [
      card('pc', { accounts: [account('john', { limits: limits(42) }), account('jane'), account('spare')], active: 'john' }),
      card('m1', { accounts: [account('folder', { email: 'John@example.com', limits: limits(90) }), account('jane', { longToken: true })], active: 'folder' }),
      card('m2', { accounts: [account('jane', { signedIn: false }), account('john')], active: 'jane' }),
      card('m3', { accounts: [account('jane', { longToken: true, limits: limits(75) })], active: 'jane' }),
    ]
    const blocks = headerAccounts(cards, view({ pool: [{ project: 'ABC', provider: 'claude', account: 'jane' }] }))
    expect(blocks.map((block) => [block.email, block.entry?.key, block.limits?.fiveHour?.usedPercentage, block.machines.map((each) => `${each.id}${each.token ? ':token' : ''}`)])).toEqual([
      ['john@example.com', 'john', 42, ['pc', 'm1', 'm2']],
      ['jane@example.com', 'jane', 75, ['pc', 'm1:token', 'm3:token']],
    ])
  })

  it('takes the limits of the first machine that read them, and keeps an account only on machines elsewhere', () => {
    const cards = [
      card('pc', { accounts: [account('john', { signedIn: false })] }),
      card('m1', { accounts: [account('john', { limits: limits(60) }), account('other', { agent: 'codex', email: null })], active: 'other' }),
    ]
    const blocks = headerAccounts(cards, view())
    expect(blocks.map((block) => [block.email, block.agent, block.entry?.key ?? null, block.limits?.fiveHour?.usedPercentage ?? null, block.machines.map((each) => each.id)])).toEqual([
      ['john@example.com', 'claude', 'john', 60, ['m1']],
      [null, 'codex', null, null, ['m1']],
    ])
  })
})
