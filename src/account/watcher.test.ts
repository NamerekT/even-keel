import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountHomes } from './homes.js'
import type { KeyVerdict } from './keycheck.js'
import { AccountWatcher, type AccountWatcherOptions } from './watcher.js'

const OLD = 'sk-ant-api03-FAKE0000000000000000000000000000-oldkey'
const NEXT = 'sk-ant-api03-FAKE1111111111111111111111111111-newkey'
const API_STATUS = { loggedIn: true, authMethod: 'api_key', email: null, orgName: null, subscriptionType: null }

describe('AccountWatcher.replaceApiKey (BTN-418)', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  /** A watcher over one Claude API account `work` whose provider answers `answer` for each key. */
  async function watcher(answer: (key: string) => KeyVerdict, known: Record<string, string> = {}) {
    root = mkdtempSync(join(tmpdir(), 'even-keel-watcher-'))
    const homes = new AccountHomes({ CLAUDE_CONFIG_DIR: join(root, 'no-global'), CODEX_HOME: join(root, 'no-codex') }, join(root, 'claude'), join(root, 'codex'), join(root, 'opencode'), join(root, 'copilot'))
    homes.addApiKey('work', OLD)
    const organizations = new Map(Object.entries(known))
    const checked: string[] = []
    const options = {
      homes,
      agentOf: () => ({ authStatus: async () => API_STATUS }),
      apps: { list: () => [] },
      active: () => 'work',
      nameOf: () => null,
      transportOf: () => null,
      loginBlock: () => null,
      sessionsIn: () => [],
      projectsOn: () => [],
      pool: () => [],
      missing: () => [],
      online: async () => true,
      sessionsKnown: () => true,
      removing: () => false,
      configPending: () => false,
      limits: () => null,
      usage: () => ({ state: 'ok' }),
      checkKey: async (_agent: string, key: string) => {
        checked.push(key)
        return answer(key)
      },
      keyCheckMs: 60 * 60_000,
      checkCredit: async () => ({ state: 'unknown', reason: 'none' }),
      creditCheckMs: 60 * 60_000,
      organizations: {
        of: (key: string) => organizations.get(key),
        note: (key: string, organization: string) => void organizations.set(key, organization),
        forget: (key: string) => void organizations.delete(key),
      },
      now: () => new Date('2026-10-26T12:00:00.000Z'),
      onChange: () => {},
      onError: (error: unknown) => {
        throw error
      },
    } as unknown as AccountWatcherOptions
    const accounts = new AccountWatcher(options)
    await accounts.refresh()
    return { accounts, homes, organizations, checked, home: homes.find('work')!, options }
  }

  const refusal = (code: string) => expect.objectContaining({ notice: expect.objectContaining({ code }) })

  it('checks sign-in without constructing the view that asks for usage', async () => {
    const { accounts, options } = await watcher(() => ({ state: 'ok' }))
    options.usage = (key) => ({ state: accounts.needsLogin(key) ? 'waiting' : 'ok', reason: null, since: null })
    expect(accounts.needsLogin('missing')).toBe(true)
    expect(accounts.view.accounts[0]).toMatchObject({ needsLogin: false, usage: { state: 'ok' } })
  })

  it('writes a key the provider takes, of the same organization, and clears the refusal at once', async () => {
    const { accounts, homes, home, organizations } = await watcher((key) => (key === OLD ? { state: 'rejected' } : { state: 'ok', organization: 'org-a' }), { work: 'org-a' })
    expect(accounts.view.accounts[0]).toMatchObject({ key: 'work', needsLogin: true, keyReplaceable: true })
    expect(accounts.needsLogin('work')).toBe(true)
    await accounts.replaceApiKey('work', NEXT)
    expect(homes.apiKeyOf(home)).toBe(NEXT)
    expect(accounts.view.accounts[0]).toMatchObject({ key: 'work', needsLogin: false })
    expect(accounts.needsLogin('work')).toBe(false)
    expect(organizations.get('work')).toBe('org-a')
  })

  it('refuses a key of another organization and keeps the old one', async () => {
    const { accounts, homes, home } = await watcher((key) => (key === OLD ? { state: 'rejected' } : { state: 'ok', organization: 'org-b' }), { work: 'org-a' })
    await expect(accounts.replaceApiKey('work', NEXT)).rejects.toThrow(refusal('account.keyOtherOrganization'))
    expect(homes.apiKeyOf(home)).toBe(OLD)
    expect(accounts.view.accounts[0]?.needsLogin).toBe(true)
  })

  it('takes the key when no organization is known or the answer names none, and keeps the one it names', async () => {
    const named = await watcher((key) => (key === OLD ? { state: 'rejected' } : { state: 'ok', organization: 'org-b' }))
    await named.accounts.replaceApiKey('work', NEXT)
    expect(named.organizations.get('work')).toBe('org-b')
    rmSync(root, { recursive: true, force: true })
    const silent = await watcher((key) => (key === OLD ? { state: 'rejected' } : { state: 'ok' }), { work: 'org-a' })
    await silent.accounts.replaceApiKey('work', NEXT)
    expect(silent.homes.apiKeyOf(silent.home)).toBe(NEXT)
    expect(silent.organizations.get('work')).toBe('org-a')
  })

  it('writes nothing when the provider refuses the key or cannot be asked', async () => {
    const refused = await watcher(() => ({ state: 'rejected' }))
    await expect(refused.accounts.replaceApiKey('work', NEXT)).rejects.toThrow(refusal('account.apiKeyRejected'))
    expect(refused.homes.apiKeyOf(refused.home)).toBe(OLD)
    rmSync(root, { recursive: true, force: true })
    const offline = await watcher((key) => (key === OLD ? { state: 'ok' } : { state: 'unknown', reason: 'fetch failed' }))
    await expect(offline.accounts.replaceApiKey('work', NEXT)).rejects.toThrow(refusal('account.apiKeyUnchecked'))
    expect(offline.homes.apiKeyOf(offline.home)).toBe(OLD)
  })

  it('refuses a malformed key before asking the provider', async () => {
    const { accounts, checked } = await watcher(() => ({ state: 'ok' }))
    await expect(accounts.replaceApiKey('work', 'short')).rejects.toThrow(refusal('account.apiKeyInvalid'))
    expect(checked).toEqual([OLD])
  })

  it("keeps the organization a working key's hourly check names", async () => {
    const { organizations } = await watcher(() => ({ state: 'ok', organization: 'org-a' }))
    expect(organizations.get('work')).toBe('org-a')
  })
})
