import { describe, expect, it } from 'vitest'
import type { AccountEntry, AccountView } from '../../src/account/model.js'
import { accountSlot, folderEmail } from './accounts.js'

const entry = (key: string, email: string | null): AccountEntry => ({
  key,
  name: null,
  global: key === 'global',
  agent: 'claude',
  status: email === null ? null : { loggedIn: true, authMethod: null, email, orgName: null, subscriptionType: null },
  error: null,
  loginExpiresAt: null,
  needsLogin: false,
  sessions: [],
  removing: false,
  configPending: false,
  apiKey: false,
  limits: null,
  usage: { state: 'ok', reason: null, since: null },
})

const view = (accounts: AccountEntry[]): AccountView => ({ active: 'global', accounts, login: null, loginBlock: null, apps: [] })

describe('accountSlot', () => {
  const accounts = view([entry('work', 'jane@example.com'), entry('global', 'john@example.com'), entry('spare', null)])

  it('gives each account a colour by the order of its folder key, whatever the list order', () => {
    expect(accountSlot(accounts, 'john@example.com')).toBe(1)
    expect(accountSlot(accounts, 'jane@example.com')).toBe(3)
  })

  it('has no colour for an e-mail no folder has now', () => {
    expect(accountSlot(accounts, 'richard@example.com')).toBeNull()
    expect(accountSlot(undefined, 'john@example.com')).toBeNull()
  })

  it('wraps around the eight series colours', () => {
    const many = view(Array.from({ length: 10 }, (_, index) => entry(`k${index}`, `u${index}@example.com`)))
    expect(accountSlot(many, 'u8@example.com')).toBe(1)
  })
})

describe('folderEmail', () => {
  it('names a folder by its e-mail, else by its key', () => {
    const accounts = view([entry('work', 'jane@example.com'), entry('spare', null)])
    expect(folderEmail(accounts, 'work')).toBe('jane@example.com')
    expect(folderEmail(accounts, 'spare')).toBe('spare')
    expect(folderEmail(accounts, 'gone')).toBe('gone')
  })
})
