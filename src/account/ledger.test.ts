import { describe, expect, it } from 'vitest'
import { accountAt, emptyLedger, noteAccount } from './ledger.js'

const now = new Date('2026-09-27T16:00:00.000Z')

describe('noteAccount', () => {
  it('starts the first seen account now, since nothing tells when it began', () => {
    expect(noteAccount(emptyLedger(), 'john@example.com', now)).toEqual({
      email: 'john@example.com',
      since: '2026-09-27T16:00:00.000Z',
      previous: null,
    })
  })

  it('moves the current account to previous on a switch', () => {
    const ledger = { email: 'john@example.com', since: '2026-09-27T10:00:00.000Z', previous: null }
    expect(noteAccount(ledger, 'jane@example.com', now)).toEqual({
      email: 'jane@example.com',
      since: '2026-09-27T16:00:00.000Z',
      previous: 'john@example.com',
    })
  })

  it('reports no change for the same account or an unknown one', () => {
    const ledger = { email: 'john@example.com', since: '2026-09-27T10:00:00.000Z', previous: null }
    expect(noteAccount(ledger, 'john@example.com', now)).toBeUndefined()
    expect(noteAccount(ledger, null, now)).toBeUndefined()
  })
})

describe('accountAt', () => {
  const ledger = { email: 'jane@example.com', since: '2026-09-27T16:00:00.000Z', previous: 'john@example.com' }

  it('names the account that was signed in at that moment', () => {
    expect(accountAt(ledger, '2026-09-27T16:00:00.000Z')).toBe('jane@example.com')
    expect(accountAt(ledger, '2026-09-27T14:39:02.453Z')).toBe('john@example.com')
  })

  it('knows nothing before the first account it saw', () => {
    expect(accountAt({ email: 'john@example.com', since: '2026-09-27T16:00:00.000Z', previous: null }, '2026-09-27T14:00:00.000Z')).toBeNull()
    expect(accountAt(emptyLedger(), '2026-09-27T14:00:00.000Z')).toBeNull()
  })
})
