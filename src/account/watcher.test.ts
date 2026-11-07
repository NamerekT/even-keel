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

  it('names a CLI installed since the last poll as found at once, as the CLI copy does (BTN-639)', async () => {
    const { accounts, options } = await watcher(() => ({ state: 'ok' }))
    let absent = ['opencode']
    options.missing = () => absent
    await accounts.refresh()
    absent = []
    expect(accounts.missingNow()).toEqual([])
  })

  it('gives a signed-out folder the e-mail it was last signed in as, and the account it is named after (BTN-528)', async () => {
    const { accounts, options } = await watcher(() => ({ state: 'ok' }))
    options.signedInAs = () => ({ last: 'john.doe@example.com', former: 'jane.roe@example.com' })
    options.agentOf = (() => ({ authStatus: async () => ({ ...API_STATUS, loggedIn: false, authMethod: null }) })) as never
    await accounts.refresh()
    expect(accounts.view.accounts[0]).toMatchObject({ lastEmail: 'john.doe@example.com', formerEmail: 'jane.roe@example.com' })
    options.agentOf = (() => ({ authStatus: async () => ({ ...API_STATUS, authMethod: 'claude.ai', email: 'jane.roe@example.com' }) })) as never
    await accounts.refresh()
    expect(accounts.view.accounts[0]).not.toHaveProperty('lastEmail')
  })

  it("gives only a signed-out folder its agent's terminal sign-in (EKR-73)", async () => {
    const { accounts, options } = await watcher(() => ({ state: 'ok' }))
    let status: import('./model.js').AccountStatus = { ...API_STATUS, loggedIn: false, authMethod: 'none' }
    options.agentOf = (() => ({ authStatus: async () => status, terminalLogin: () => "COPILOT_HOME='/c' copilot login" })) as never
    await accounts.refresh()
    expect(accounts.view.accounts[0]).toMatchObject({ needsLogin: true, terminalLogin: "COPILOT_HOME='/c' copilot login" })
    status = { ...status, loggedIn: true }
    await accounts.refresh()
    expect(accounts.view.accounts[0]).not.toHaveProperty('terminalLogin')
    status = { ...status, loggedIn: null }
    await accounts.refresh()
    expect(accounts.view.accounts[0]).toMatchObject({ needsLogin: false, status: { loggedIn: null }, error: null })
    expect(accounts.view.accounts[0]).not.toHaveProperty('terminalLogin')
  })

  it("keeps the organization a working key's hourly check names", async () => {
    const { organizations } = await watcher(() => ({ state: 'ok', organization: 'org-a' }))
    expect(organizations.get('work')).toBe('org-a')
  })
})

describe('AccountWatcher.addCloud (BTN-822)', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const CLOUD_STATUS = { loggedIn: true, authMethod: 'third_party', email: null, orgName: null, subscriptionType: null }
  const connection = { cloud: 'bedrock', region: 'eu-central-1', auth: { way: 'profile', profile: 'work' } } as const

  function watcher(check: () => Promise<{ model: string | null }>) {
    root = mkdtempSync(join(tmpdir(), 'even-keel-watcher-'))
    const homes = new AccountHomes({ CLAUDE_CONFIG_DIR: join(root, 'no-global'), CODEX_HOME: join(root, 'no-codex') }, join(root, 'claude'), join(root, 'codex'), join(root, 'opencode'), join(root, 'copilot'))
    const named: Array<[string, string]> = []
    const options = {
      homes,
      agentOf: () => ({ authStatus: async () => CLOUD_STATUS }),
      apps: { list: () => [] },
      active: () => 'bedrock',
      nameOf: () => null,
      name: (key: string, name: string) => void named.push([key, name]),
      transportOf: () => null,
      loginBlock: () => null,
      sessionsIn: () => [],
      projectsOn: () => [],
      pool: () => [],
      makeShared: () => {},
      missing: () => [],
      online: async () => true,
      sessionsKnown: () => true,
      removing: () => false,
      configPending: () => false,
      limits: () => null,
      usage: () => ({ state: 'ok' }),
      checkCloud: check,
      awsProfiles: () => ({ profiles: [{ name: 'work', region: null, shortLived: false }], user: 'john', home: 'C:\\Users\\john' }),
      whose: () => ({ user: 'john', home: 'C:\\Users\\john' }),
      checkKey: async () => ({ state: 'ok' }),
      keyCheckMs: 60 * 60_000,
      checkCredit: async () => ({ state: 'unknown', reason: 'none' }),
      creditCheckMs: 60 * 60_000,
      organizations: { of: () => undefined, note: () => {}, forget: () => {} },
      now: () => new Date('2026-10-26T12:00:00.000Z'),
      onChange: () => {},
      onError: (error: unknown) => {
        throw error
      },
    } as unknown as AccountWatcherOptions
    return { accounts: new AccountWatcher(options), homes, named }
  }

  it('keeps a folder whose check turn answered, with the cloud and the model that answered, as an account paying per token', async () => {
    const { accounts, named } = watcher(async () => ({ model: 'eu.anthropic.claude-sonnet-fake' }))
    await accounts.addCloud('AWS work', connection)
    expect(named).toEqual([['aws-work', 'AWS work']])
    expect(accounts.view.accounts[0]).toMatchObject({
      key: 'aws-work',
      apiKey: false,
      cloud: { cloud: 'bedrock', region: 'eu-central-1', way: 'profile', profile: 'work', shortLived: false },
      checkedModel: 'eu.anthropic.claude-sonnet-fake',
      status: { email: 'aws-work' },
    })
    expect(accounts.apiKey('aws-work')).toBe(true)
  })

  it("removes the folder again on a refused check and says the cloud's reason, naming whose AWS files were read", async () => {
    const { accounts, homes } = watcher(async () => {
      throw new Error('Could not load credentials from any providers')
    })
    await expect(accounts.addCloud('', connection)).rejects.toThrow(
      expect.objectContaining({ notice: { code: 'cloud.awsCredentials', params: { user: 'john', home: 'C:\\Users\\john' } } }),
    )
    expect(homes.list().filter((home) => !home.global)).toEqual([])
  })

  it('says an unknown refusal as it came', async () => {
    const { accounts } = watcher(async () => {
      throw new Error('spawn claude ENOENT')
    })
    await expect(accounts.addCloud('', connection)).rejects.toThrow(
      expect.objectContaining({ notice: { code: 'account.cloudCheckFailed', params: { reason: 'spawn claude ENOENT' } } }),
    )
  })

  it("puts the service user's AWS profiles into the view when the form asks", () => {
    const { accounts } = watcher(async () => ({ model: null }))
    expect(accounts.view.aws).toBeUndefined()
    accounts.readAws()
    expect(accounts.view.aws).toEqual({ profiles: [{ name: 'work', region: null, shortLived: false }], user: 'john', home: 'C:\\Users\\john' })
  })
})
