import { describe, expect, it } from 'vitest'
import { accountAt, emptyLedger, forgetAccount, markRemoving, nameAccount, noteAccount, parseLedger, type AccountLedger } from './ledger.js'

const now = new Date('2026-09-27T16:00:00.000Z')

describe('noteAccount', () => {
  it('starts the first seen account of a folder now, since nothing tells when it began', () => {
    expect(noteAccount(emptyLedger(), 'work', 'john@example.com', now)).toEqual({
      accounts: { work: { email: 'john@example.com', since: '2026-09-27T16:00:00.000Z', previous: null } },
      removing: [],
    })
  })

  it('moves the folder account to previous when another one signs in there', () => {
    const ledger: AccountLedger = {
      accounts: { global: { email: 'john@example.com', since: '2026-09-27T10:00:00.000Z', previous: null } },
      removing: [],
    }
    expect(noteAccount(ledger, 'global', 'jane@example.com', now)?.accounts.global).toEqual({
      email: 'jane@example.com',
      since: '2026-09-27T16:00:00.000Z',
      previous: 'john@example.com',
    })
  })

  it('reports no change for the same account or an unknown one', () => {
    const ledger: AccountLedger = {
      accounts: { global: { email: 'john@example.com', since: '2026-09-27T10:00:00.000Z', previous: null } },
      removing: [],
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

  it('keeps the name of the account when its folder notes an e-mail', () => {
    const named = nameAccount(emptyLedger(), 'work-api', 'Work API')
    expect(noteAccount(named, 'work-api', 'work-api', now)?.accounts['work-api']).toEqual({
      email: 'work-api',
      since: '2026-09-27T16:00:00.000Z',
      previous: null,
      name: 'Work API',
    })
  })
})

describe('nameAccount', () => {
  it('names a folder it has not seen yet without telling when its account began', () => {
    expect(nameAccount(emptyLedger(), 'work-api', '  Work API ').accounts).toEqual({
      'work-api': { email: null, since: null, previous: null, name: 'Work API' },
    })
  })

  it('renames a known folder and drops the name when it is blank', () => {
    const ledger = noteAccount(emptyLedger(), 'work', 'jane@example.com', now)!
    const named = nameAccount(ledger, 'work', 'Work')
    expect(named.accounts.work).toEqual({ ...ledger.accounts.work, name: 'Work' })
    expect(nameAccount(named, 'work', ' ').accounts.work).toEqual(ledger.accounts.work)
  })
})

describe('accountAt', () => {
  const ledger: AccountLedger = {
    accounts: { global: { email: 'jane@example.com', since: '2026-09-27T16:00:00.000Z', previous: 'john@example.com' } },
    removing: [],
  }

  it('names the account that was signed in to the folder at that moment', () => {
    expect(accountAt(ledger, 'global', '2026-09-27T16:00:00.000Z')).toBe('jane@example.com')
    expect(accountAt(ledger, 'global', '2026-09-27T14:39:02.453Z')).toBe('john@example.com')
  })

  it('knows nothing before the first account it saw or for a folder it never saw', () => {
    expect(accountAt(ledger, 'work', '2026-09-27T16:00:00.000Z')).toBeNull()
    expect(accountAt(emptyLedger(), 'global', '2026-09-27T14:00:00.000Z')).toBeNull()
    const fresh: AccountLedger = { accounts: { global: { email: 'john@example.com', since: now.toISOString(), previous: null } }, removing: [] }
    expect(accountAt(fresh, 'global', '2026-09-27T14:00:00.000Z')).toBeNull()
  })
})

describe('forgetAccount', () => {
  it('forgets a removed folder', () => {
    const ledger = noteAccount(emptyLedger(), 'work', 'jane@example.com', now)!
    expect(forgetAccount(ledger, 'work').accounts).toEqual({})
  })

  it('marks a folder for removal once, unmarks it and forgets the mark with the folder', () => {
    const marked = markRemoving(markRemoving(emptyLedger(), 'work', true), 'work', true)
    expect(marked.removing).toEqual(['work'])
    expect(markRemoving(marked, 'work', false).removing).toEqual([])
    expect(forgetAccount(marked, 'work').removing).toEqual([])
  })
})

describe('parseLedger', () => {
  it('reads the per-folder journal', () => {
    const raw = {
      accounts: { work: { email: 'jane@example.com', since: '2026-09-27T16:00:00.000Z', previous: null } },
      removing: ['old'],
    }
    expect(parseLedger(raw)).toEqual(raw)
    expect(parseLedger({ ...raw, active: 'work' })).toEqual(raw)
  })

  it('reads the name of an account and nothing that is not text', () => {
    const raw = {
      accounts: {
        work: { email: 'work', since: '2026-09-27T16:00:00.000Z', previous: null, name: 'Work API' },
        spare: { email: null, since: null, previous: null, name: 7 },
      },
      removing: [],
    }
    expect(parseLedger(raw).accounts).toEqual({
      work: raw.accounts.work,
      spare: { email: null, since: null, previous: null },
    })
  })

  it('reads a journal written before folders could wait for removal', () => {
    expect(parseLedger({ accounts: {} }).removing).toEqual([])
  })

  it('carries the single-account journal over as the global folder', () => {
    const raw = { email: 'john@example.com', since: '2026-09-27T10:00:00.000Z', previous: 'jane@example.com' }
    expect(parseLedger(raw)).toEqual({ accounts: { global: raw }, removing: [] })
  })

  it('starts empty from anything else', () => {
    expect(parseLedger(null)).toEqual(emptyLedger())
    expect(parseLedger({ active: 7, accounts: [] })).toEqual(emptyLedger())
  })
})
