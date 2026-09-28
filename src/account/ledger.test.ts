import { describe, expect, it } from 'vitest'
import { accountAt, activate, emptyLedger, forgetAccount, noteAccount, parseLedger, type AccountLedger } from './ledger.js'

const now = new Date('2026-09-27T16:00:00.000Z')

describe('noteAccount', () => {
  it('starts the first seen account of a folder now, since nothing tells when it began', () => {
    expect(noteAccount(emptyLedger(), 'work', 'john@example.com', now)).toEqual({
      active: 'global',
      accounts: { work: { email: 'john@example.com', since: '2026-09-27T16:00:00.000Z', previous: null } },
    })
  })

  it('moves the folder account to previous when another one signs in there', () => {
    const ledger: AccountLedger = {
      active: 'global',
      accounts: { global: { email: 'john@example.com', since: '2026-09-27T10:00:00.000Z', previous: null } },
    }
    expect(noteAccount(ledger, 'global', 'jane@example.com', now)?.accounts.global).toEqual({
      email: 'jane@example.com',
      since: '2026-09-27T16:00:00.000Z',
      previous: 'john@example.com',
    })
  })

  it('reports no change for the same account or an unknown one', () => {
    const ledger: AccountLedger = {
      active: 'global',
      accounts: { global: { email: 'john@example.com', since: '2026-09-27T10:00:00.000Z', previous: null } },
    }
    expect(noteAccount(ledger, 'global', 'john@example.com', now)).toBeUndefined()
    expect(noteAccount(ledger, 'global', null, now)).toBeUndefined()
  })

  it('keeps each folder to itself', () => {
    const ledger = noteAccount(emptyLedger(), 'global', 'john@example.com', now)!
    const both = noteAccount(ledger, 'work', 'jane@example.com', now)!
    expect(both.accounts.global?.email).toBe('john@example.com')
    expect(both.accounts.work?.email).toBe('jane@example.com')
  })
})

describe('accountAt', () => {
  const ledger: AccountLedger = {
    active: 'global',
    accounts: { global: { email: 'jane@example.com', since: '2026-09-27T16:00:00.000Z', previous: 'john@example.com' } },
  }

  it('names the account that was signed in to the folder at that moment', () => {
    expect(accountAt(ledger, 'global', '2026-09-27T16:00:00.000Z')).toBe('jane@example.com')
    expect(accountAt(ledger, 'global', '2026-09-27T14:39:02.453Z')).toBe('john@example.com')
  })

  it('knows nothing before the first account it saw or for a folder it never saw', () => {
    expect(accountAt(ledger, 'work', '2026-09-27T16:00:00.000Z')).toBeNull()
    expect(accountAt(emptyLedger(), 'global', '2026-09-27T14:00:00.000Z')).toBeNull()
    const fresh: AccountLedger = { active: 'global', accounts: { global: { email: 'john@example.com', since: now.toISOString(), previous: null } } }
    expect(accountAt(fresh, 'global', '2026-09-27T14:00:00.000Z')).toBeNull()
  })
})

describe('activate and forgetAccount', () => {
  it('switches the active folder and forgets a removed one', () => {
    const ledger = noteAccount(emptyLedger(), 'work', 'jane@example.com', now)!
    expect(activate(ledger, 'work').active).toBe('work')
    expect(forgetAccount(ledger, 'work').accounts).toEqual({})
  })
})

describe('parseLedger', () => {
  it('reads the per-folder journal', () => {
    const raw = { active: 'work', accounts: { work: { email: 'jane@example.com', since: '2026-09-27T16:00:00.000Z', previous: null } } }
    expect(parseLedger(raw)).toEqual(raw)
  })

  it('carries the single-account journal over as the global folder', () => {
    const raw = { email: 'john@example.com', since: '2026-09-27T10:00:00.000Z', previous: 'jane@example.com' }
    expect(parseLedger(raw)).toEqual({ active: 'global', accounts: { global: raw } })
  })

  it('starts empty from anything else', () => {
    expect(parseLedger(null)).toEqual(emptyLedger())
    expect(parseLedger({ active: 7, accounts: [] })).toEqual(emptyLedger())
  })
})
