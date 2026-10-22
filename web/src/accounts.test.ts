import { describe, expect, it } from 'vitest'
import type { AccountEntry, AccountView } from '../../src/account/model.js'
import { accountGroups, accountSlot, addStep, canAdd, cliMissing, connectionOf, deviceLogin, entrySlot, folderEmail, offeredProviders } from './accounts.js'

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
  projects: [],
  removing: false,
  configPending: false,
  apiKey: false,
  limits: null,
  usage: { state: 'ok', reason: null, since: null },
})

const view = (accounts: AccountEntry[]): AccountView => ({ active: 'global', accounts, login: null, loginBlock: null, apps: [], pool: [], missing: [] })

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

describe('entrySlot', () => {
  it('colours a folder by its e-mail, and one without an e-mail by its own key', () => {
    const accounts = view([entry('work', 'jane@example.com'), entry('global', 'john@example.com'), entry('spare', null), entry('codex', 'jane@example.com')])
    expect(entrySlot(accounts, accounts.accounts[0]!)).toBe(4)
    expect(entrySlot(accounts, accounts.accounts[3]!)).toBe(4)
    expect(entrySlot(accounts, accounts.accounts[2]!)).toBe(3)
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

describe('connectionOf', () => {
  it('tells an account on a key from one signed in through the CLI', () => {
    expect(connectionOf(entry('work', 'jane@example.com'))).toBe('cli')
    expect(connectionOf({ ...entry('ci', 'ci'), apiKey: true })).toBe('apiKey')
  })
})

describe('deviceLogin', () => {
  const login = (agent: string, target: string | null) => ({ agent, target, startedAt: '', urls: [], output: '', error: null, codeSent: false })
  const accounts = [entry('global', 'john@example.com'), { ...entry('codex', 'john@example.com'), agent: 'codex' }]

  it("is Codex's sign-in, into a folder or a new account, where the code goes on the sign-in page, not here", () => {
    expect(deviceLogin({ ...view(accounts), login: login('codex', 'codex') })).toBe(true)
    expect(deviceLogin({ ...view(accounts), login: login('codex', null) })).toBe(true)
  })

  it("is OpenCode's sign-in too: ChatGPT and Copilot print a device code", () => {
    expect(deviceLogin({ ...view(accounts), login: login('opencode', null) })).toBe(true)
  })

  it('is not a Claude sign-in or no sign-in at all', () => {
    expect(deviceLogin({ ...view(accounts), login: login('claude', 'global') })).toBe(false)
    expect(deviceLogin({ ...view(accounts), login: login('claude', null) })).toBe(false)
    expect(deviceLogin(view(accounts))).toBe(false)
  })
})

describe('canAdd', () => {
  it('adds Claude, Codex and OpenCode through the CLI or a key', () => {
    for (const provider of ['claude', 'codex', 'opencode'] as const) {
      expect(canAdd(provider)).toBe(true)
      expect(canAdd(provider, 'cli')).toBe(true)
      expect(canAdd(provider, 'apiKey')).toBe(true)
    }
  })

  it('shows the Agent SDK as not there yet', () => {
    expect(canAdd('claude', 'sdk')).toBe(false)
    expect(canAdd('codex', 'sdk')).toBe(false)
    expect(canAdd('opencode', 'sdk')).toBe(false)
  })
})

describe('addStep', () => {
  const step = (search: string) => addStep(new URLSearchParams(search))

  it('starts with the provider', () => {
    expect(step('')).toEqual({ provider: null, connection: null })
  })

  it('goes on to the connection, then to the sign-in', () => {
    expect(step('provider=codex')).toEqual({ provider: 'codex', connection: null })
    expect(step('provider=claude&connection=apiKey')).toEqual({ provider: 'claude', connection: 'apiKey' })
  })

  it('drops what it does not know, and a connection without a provider', () => {
    expect(step('provider=gemini&connection=cli')).toEqual({ provider: null, connection: null })
    expect(step('provider=claude&connection=token')).toEqual({ provider: 'claude', connection: null })
    expect(step('connection=cli')).toEqual({ provider: null, connection: null })
  })

  it('goes on to an OpenCode sign-in', () => {
    expect(step('provider=opencode&connection=cli')).toEqual({ provider: 'opencode', connection: 'cli' })
  })
})

describe('accountGroups', () => {
  const now = new Date('2026-10-10T10:00:00.000Z')
  const of = (key: string, agent: string, patch: Partial<AccountEntry> = {}) => ({ ...entry(key, `${key}@example.com`), agent, ...patch })
  const groups = (accounts: AccountEntry[], active = 'global') =>
    accountGroups({ ...view(accounts), active, missing: ['opencode'] }, now).map((group) => [group.agent, group.entries.map((each) => each.key)])

  it('groups the accounts by provider in the providers order, the chain account first in its group', () => {
    expect(groups([of('zen', 'opencode'), of('codex', 'codex'), of('work', 'claude'), of('global', 'claude')], 'global')).toEqual([
      ['claude', ['global', 'work']],
      ['codex', ['codex']],
      ['opencode', ['zen']],
    ])
  })

  it('keeps the accounts that cannot work last inside a group', () => {
    expect(groups([of('spent', 'claude', { needsLogin: true }), of('work', 'claude')], 'none')).toEqual([
      ['claude', ['work', 'spent']],
      ['codex', []],
    ])
  })

  it('lists an addable provider with no account as an empty group, and an agent it does not know after the rest', () => {
    expect(accountGroups({ ...view([of('global', 'claude'), of('other', 'gemini')]) }, now).map((group) => group.agent)).toEqual([
      'claude',
      'codex',
      'opencode',
      'gemini',
    ])
  })

  it('drops the empty group of a provider whose CLI is not found, and keeps one that has accounts', () => {
    const missing = (accounts: AccountEntry[]) =>
      accountGroups({ ...view(accounts), missing: ['codex', 'opencode'] }, now).map((group) => [group.agent, group.entries.map((each) => each.key)])
    expect(missing([of('global', 'claude')])).toEqual([['claude', ['global']]])
    expect(missing([of('global', 'claude'), of('work', 'codex')])).toEqual([
      ['claude', ['global']],
      ['codex', ['work']],
    ])
  })
})

describe('cliMissing', () => {
  it('names a provider whose CLI the service does not find', () => {
    expect(cliMissing({ ...view([]), missing: ['codex'] }, 'codex')).toBe(true)
    expect(cliMissing({ ...view([]), missing: ['codex'] }, 'claude')).toBe(false)
  })
})

describe('offeredProviders', () => {
  const of = (key: string, agent: string) => ({ ...entry(key, `${key}@example.com`), agent })

  it('offers a provider only once it has an account, or while a setting already names it', () => {
    const account = view([of('global', 'claude')])
    expect(offeredProviders(account, [])).toEqual(['claude'])
    expect(offeredProviders(account, ['', 'codex'])).toEqual(['claude', 'codex'])
    expect(offeredProviders(view([of('global', 'claude'), of('work', 'codex')]), [])).toEqual(['claude', 'codex'])
  })

  it('offers every provider until the accounts are known', () => {
    expect(offeredProviders(null, [])).toEqual(['claude', 'codex', 'opencode'])
  })
})
