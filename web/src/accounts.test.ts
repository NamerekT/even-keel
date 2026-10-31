import { describe, expect, it } from 'vitest'
import type { AccountEntry, AccountView } from '../../src/account/model.js'
import type { RateLimits } from '../../src/limits/model.js'
import {
  ACCESS_OWNER,
  accessGroups,
  accessOf,
  accountGroups,
  accountSlot,
  cliMissing,
  connectionOf,
  deviceLogin,
  entrySlot,
  foreignAccount,
  offeredProviders,
  readinessOf,
  tightestWindow,
} from './accounts.js'

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

describe('foreignAccount', () => {
  const own = { ...entry('work', 'jane@example.com'), projects: ['p-1'] }
  const accounts = view([own, entry('global', 'john@example.com')])

  it('is not the account the project runs on', () => {
    expect(foreignAccount(accounts, 'p-1', 'jane@example.com')).toBe(false)
    expect(foreignAccount(accounts, 'p-1', 'john@example.com')).toBe(true)
    expect(foreignAccount(accounts, 'p-2', 'jane@example.com')).toBe(true)
  })

  it('takes an e-mail no folder has now for a foreign one, and an unknown one for none', () => {
    expect(foreignAccount(accounts, 'p-1', 'richard@example.com')).toBe(true)
    expect(foreignAccount(undefined, 'p-1', 'jane@example.com')).toBe(true)
    expect(foreignAccount(accounts, 'p-1', null)).toBe(false)
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

describe('connectionOf', () => {
  it('tells an account on a key from one signed in through the CLI', () => {
    expect(connectionOf(entry('work', 'jane@example.com'))).toBe('cli')
    expect(connectionOf({ ...entry('ci', 'ci'), apiKey: true })).toBe('apiKey')
  })
})

describe('accessOf', () => {
  const of = (agent: string, patch: Partial<AccountEntry> = {}, providers: string | null = null) => {
    const base = { ...entry('key', null), agent, ...patch }
    return { ...base, status: { loggedIn: true, authMethod: null, email: null, orgName: null, subscriptionType: providers } }
  }

  it('tells a subscription from a key of the same provider', () => {
    expect(accessOf(of('claude'))).toBe('claudeSubscription')
    expect(accessOf(of('claude', { apiKey: true }))).toBe('anthropicKey')
    expect(accessOf(of('codex'))).toBe('chatgpt')
    expect(accessOf(of('codex', { apiKey: true }))).toBe('openaiKey')
  })

  it('puts every Copilot account, a token or the machine sign-in, under GitHub', () => {
    expect(accessOf(of('copilot'))).toBe('github')
    expect(accessOf(of('copilot', { apiKey: true }))).toBe('github')
  })

  it("reads an OpenCode folder by the provider whose limits it shows, a key by the key's provider", () => {
    expect(accessOf(of('opencode', {}, 'openai'))).toBe('chatgpt')
    expect(accessOf(of('opencode', {}, 'github-copilot'))).toBe('github')
    expect(accessOf(of('opencode', {}, 'openai, github-copilot'))).toBe('chatgpt')
    expect(accessOf(of('opencode', {}, 'anthropic'))).toBe('claudeSubscription')
    expect(accessOf(of('opencode', { apiKey: true }, 'anthropic'))).toBe('anthropicKey')
    expect(accessOf(of('opencode', { apiKey: true }, 'openai'))).toBe('openaiKey')
  })

  it("takes an OpenCode folder with no sign-in or with OpenCode's own key for Zen", () => {
    expect(accessOf(of('opencode'))).toBe('zen')
    expect(accessOf(of('opencode', { apiKey: true }, 'opencode'))).toBe('zen')
  })

  it('has no connection of its own for an agent the page does not know', () => {
    expect(accessOf(of('gemini'))).toBe('other')
  })
})

describe('accessGroups', () => {
  const of = (key: string, agent: string, apiKey = false) => ({ ...entry(key, null), agent, apiKey })

  it('splits an agent by connection in a fixed order, keeping the order of the accounts inside', () => {
    const groups = accessGroups([of('key', 'claude', true), of('pro', 'claude'), of('max', 'claude')])
    expect(groups.map((group) => [group.access, group.entries.map((each) => each.key)])).toEqual([
      ['claudeSubscription', ['pro', 'max']],
      ['anthropicKey', ['key']],
    ])
  })

  it('names who bills each connection', () => {
    expect(ACCESS_OWNER).toMatchObject({ claudeSubscription: 'anthropic', anthropicKey: 'anthropic', chatgpt: 'openai', openaiKey: 'openai', zen: 'zen', github: 'github' })
  })
})

describe('deviceLogin', () => {
  const login = (agent: string, target: string | null) => ({ agent, target, startedAt: '', urls: [], deviceCode: null, output: '', error: null, codeSent: false })
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

describe('accountGroups', () => {
  const now = new Date('2026-10-10T10:00:00.000Z')
  const of = (key: string, agent: string, patch: Partial<AccountEntry> = {}) => ({ ...entry(key, `${key}@example.com`), agent, ...patch })
  const groups = (accounts: AccountEntry[], active = 'global') =>
    accountGroups({ ...view(accounts), active, missing: ['opencode', 'copilot'] }, now).map((group) => [group.agent, group.entries.map((each) => each.key)])

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
    ])
  })

  it('omits providers without accounts even when their CLI is available', () => {
    expect(groups([of('zen', 'opencode'), of('global', 'claude')])).toEqual([
      ['claude', ['global']],
      ['opencode', ['zen']],
    ])
  })

  it('lists an unknown agent after populated known providers', () => {
    expect(accountGroups({ ...view([of('global', 'claude'), of('other', 'gemini'), of('zen', 'opencode')]) }, now).map((group) => group.agent)).toEqual([
      'claude',
      'opencode',
      'gemini',
    ])
  })

  it('puts every account at work before idle accounts, including one that needs sign-in', () => {
    expect(groups([of('idle', 'claude'), of('busy', 'claude', { sessions: ['session'], needsLogin: true })], 'none')).toEqual([
      ['claude', ['busy', 'idle']],
    ])
  })

  it('drops the empty group of a provider whose CLI is not found, and keeps one that has accounts', () => {
    const missing = (accounts: AccountEntry[]) =>
      accountGroups({ ...view(accounts), missing: ['codex', 'opencode', 'copilot'] }, now).map((group) => [group.agent, group.entries.map((each) => each.key)])
    expect(missing([of('global', 'claude')])).toEqual([['claude', ['global']]])
    expect(missing([of('global', 'claude'), of('work', 'codex')])).toEqual([
      ['claude', ['global']],
      ['codex', ['work']],
    ])
  })
})

describe('tightestWindow', () => {
  const window = (usedPercentage: number) => ({ usedPercentage, resetsAt: '2026-10-10T12:00:00.000Z' })
  const limits = (patch: Partial<RateLimits>): RateLimits => ({ fiveHour: null, sevenDay: null, updatedAt: '2026-10-10T10:00:00.000Z', source: 'usage', ...patch })

  it('gives the window with the least left and how much is left of it', () => {
    expect(tightestWindow(limits({ fiveHour: window(37), sevenDay: window(64) }))).toEqual({ span: 'sevenDay', free: 36, window: window(64) })
    expect(tightestWindow(limits({ fiveHour: window(90.4), sevenDay: window(64) }))).toEqual({ span: 'fiveHour', free: 10, window: window(90.4) })
  })

  it("reads a monthly plan's month window", () => {
    expect(tightestWindow(limits({ month: window(12) }))).toEqual({ span: 'month', free: 88, window: window(12) })
  })

  it('skips a window that only counts what was spent', () => {
    expect(tightestWindow(limits({ month: { ...window(0), used: 52 } }))).toBeNull()
  })

  it('keeps the share within 0–100', () => {
    expect(tightestWindow(limits({ fiveHour: window(130) }))?.free).toBe(0)
    expect(tightestWindow(limits({ fiveHour: window(-5) }))?.free).toBe(100)
  })

  it('has none without a window with data', () => {
    expect(tightestWindow(null)).toBeNull()
    expect(tightestWindow(limits({}))).toBeNull()
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
    expect(offeredProviders(null, [])).toEqual(['claude', 'codex', 'opencode', 'copilot'])
  })
})

describe('readinessOf', () => {
  it('does not mark a Copilot-only OpenCode folder ready for setup or the project wizard', () => {
    const only = { ...entry('opencode', null), agent: 'opencode', status: { ...entry('opencode', null).status!, subscriptionType: 'github-copilot' } }
    expect(readinessOf(view([only]), 'opencode', 'opencode')).toEqual({ state: 'unsupported', entry: only })
    const mixed = { ...only, status: { ...only.status, subscriptionType: 'github-copilot, openai' } }
    expect(readinessOf(view([mixed]), 'opencode', 'opencode')).toEqual({ state: 'ready', entry: mixed })
  })
  const codex = { ...entry('codex', 'john@example.com'), agent: 'codex' }

  it("is ready on the pool entry's folder of the provider while it is signed in (BTN-310)", () => {
    expect(readinessOf(view([entry('global', 'jane@example.com'), codex]), 'codex', 'codex')).toEqual({ state: 'ready', entry: codex })
  })

  it('asks for a sign-in of a folder that needs one, and for an account where the entry names none of the provider', () => {
    const expired = { ...codex, needsLogin: true }
    expect(readinessOf(view([expired]), 'codex', 'codex')).toEqual({ state: 'signIn', entry: expired })
    expect(readinessOf(view([entry('global', 'jane@example.com')]), 'codex', 'global')).toEqual({ state: 'noAccount' })
    expect(readinessOf(view([]), 'opencode', '')).toEqual({ state: 'noAccount' })
  })

  it('says first that the CLI is not found', () => {
    expect(readinessOf({ ...view([codex]), missing: ['codex'] }, 'codex', 'codex')).toEqual({ state: 'cliMissing' })
  })
})
