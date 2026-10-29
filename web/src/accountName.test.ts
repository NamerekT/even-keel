import { describe, expect, it } from 'vitest'
import type { AccountEntry, AccountView } from '../../src/account/model.js'
import { accountName, folderLabel } from './accountName.js'
import { accountOptions } from './pages/settingsRun.js'

const entry = (key: string, agent: string, email: string | null, extra: Partial<AccountEntry> = {}): AccountEntry => ({
  key,
  name: null,
  global: key === 'global' || key === 'codex',
  agent,
  status: { loggedIn: true, authMethod: null, email, orgName: null, subscriptionType: null },
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
  ...extra,
})

describe('accountName', () => {
  it('takes the name the user gave, then the e-mail', () => {
    expect(accountName(entry('work', 'claude', 'jane.roe@example.com', { name: 'Work' }))).toBe('Work')
    expect(accountName(entry('global', 'claude', 'john.doe@example.com'))).toBe('john.doe@example.com')
    expect(accountName(entry('codex', 'codex', 'john.doe@example.com'))).toBe('john.doe@example.com')
  })

  it('names a folder without an e-mail after its provider, never by its key', () => {
    expect(accountName(entry('global', 'claude', null))).toBe('Claude Code')
    expect(accountName(entry('copilot', 'copilot', null))).toBe('GitHub Copilot')
    expect(accountName(entry('global', 'claude', null, { status: null }))).toBe('Claude Code')
  })

  it('does not take the folder key an API account stands in an e-mail with', () => {
    expect(accountName(entry('api', 'claude', 'api', { apiKey: true }))).toBe('Claude Code')
  })

  it('says whether an OpenCode folder is signed in to providers or runs the free models', () => {
    const signed = entry('opencode', 'opencode', null, { status: { loggedIn: true, authMethod: 'oauth', email: null, orgName: null, subscriptionType: 'openai' } })
    const free = entry('opencode', 'opencode', null, { status: { loggedIn: true, authMethod: 'none', email: null, orgName: null, subscriptionType: null } })
    expect(accountName(signed)).toBe('OpenCode')
    expect(accountName(free)).toBe('OpenCode Zen')
    expect(accountName({ ...free, status: null })).toBe('OpenCode')
  })

  it('numbers the folders that would read the same, by their keys', () => {
    const first = entry('opencode', 'opencode', null)
    const second = entry('opencode-2', 'opencode', null)
    const named = entry('opencode-3', 'opencode', null, { name: 'Spare' })
    const accounts = [second, named, first, entry('global', 'claude', null)]
    expect(accountName(first, accounts)).toBe('OpenCode Zen')
    expect(accountName(second, accounts)).toBe('OpenCode Zen 2')
    expect(accountName(accounts[3]!, accounts)).toBe('Claude Code')
  })

  it('names an agent the page does not know by its registry name', () => {
    expect(accountName(entry('gemini', 'gemini', null))).toBe('gemini')
  })
})

describe('folderLabel and accountOptions', () => {
  it('keeps a Copilot-only folder visible with a reason it cannot be selected', () => {
    const only = entry('opencode', 'opencode', null)
    only.status!.subscriptionType = 'github-copilot'
    const listed = { active: only.key, accounts: [only], login: null, loginBlock: null, apps: [], pool: [], missing: [] }
    expect(accountOptions(listed, 'opencode', only.key)[0]).toMatchObject({ value: only.key, unavailable: expect.stringContaining('Copilot') })
    only.status!.subscriptionType = 'github-copilot, openai'
    expect(accountOptions(listed, 'opencode', only.key)[0]?.unavailable).toBeUndefined()
  })
  const accounts = [entry('global', 'claude', 'john.doe@example.com'), entry('opencode', 'opencode', null), entry('opencode-2', 'opencode', null)]
  const view: AccountView = { active: 'global', accounts, login: null, loginBlock: null, apps: [], pool: [], missing: [] }

  it('give a folder the name the page shows, and a key no longer listed as it is', () => {
    expect(folderLabel(view, 'opencode-2')).toBe('OpenCode Zen 2')
    expect(folderLabel(view, 'gone')).toBe('gone')
    expect(folderLabel(undefined, 'global')).toBe('global')
  })

  it('offer the provider\'s folders by that name', () => {
    expect(accountOptions(view, 'opencode', 'opencode')).toEqual([
      { value: 'opencode', label: 'OpenCode Zen' },
      { value: 'opencode-2', label: 'OpenCode Zen 2' },
    ])
    expect(accountOptions(view, 'claude', 'gone')).toEqual([
      { value: 'global', label: 'john.doe@example.com' },
      { value: 'gone', label: 'gone' },
    ])
  })
})
