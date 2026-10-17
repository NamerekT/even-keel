import { describe, expect, it } from 'vitest'
import type { AccountEntry, AccountView } from '../../src/account/model.js'
import { accountSlot, addStep, canAdd, connectionOf, deviceLogin, folderEmail } from './accounts.js'

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

describe('connectionOf', () => {
  it('tells an account on a key from one signed in through the CLI', () => {
    expect(connectionOf(entry('work', 'jane@example.com'))).toBe('cli')
    expect(connectionOf({ ...entry('ci', 'ci'), apiKey: true })).toBe('apiKey')
  })
})

describe('deviceLogin', () => {
  const login = (target: string | null) => ({ target, startedAt: '', urls: [], output: '', error: null, codeSent: false })
  const accounts = [entry('global', 'john@example.com'), { ...entry('codex', 'john@example.com'), agent: 'codex' }]

  it('is a sign-in into the Codex folder, where the code goes on the sign-in page, not here', () => {
    expect(deviceLogin({ ...view(accounts), login: login('codex') })).toBe(true)
  })

  it('is not a Claude sign-in, a new folder or no sign-in at all', () => {
    expect(deviceLogin({ ...view(accounts), login: login('global') })).toBe(false)
    expect(deviceLogin({ ...view(accounts), login: login(null) })).toBe(false)
    expect(deviceLogin(view(accounts))).toBe(false)
  })
})

describe('canAdd', () => {
  it('adds Claude through the CLI or a key and Codex through its CLI', () => {
    expect(canAdd('claude', 'cli')).toBe(true)
    expect(canAdd('claude', 'apiKey')).toBe(true)
    expect(canAdd('codex', 'cli')).toBe(true)
  })

  it('shows the Agent SDK, a Codex key and OpenCode as not there yet', () => {
    expect(canAdd('claude', 'sdk')).toBe(false)
    expect(canAdd('codex', 'sdk')).toBe(false)
    expect(canAdd('codex', 'apiKey')).toBe(false)
    expect(canAdd('opencode')).toBe(false)
    expect(canAdd('opencode', 'cli')).toBe(false)
    expect(canAdd('claude')).toBe(true)
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

  it('does not go past a provider that cannot be added', () => {
    expect(step('provider=opencode&connection=cli')).toEqual({ provider: 'opencode', connection: null })
  })
})
