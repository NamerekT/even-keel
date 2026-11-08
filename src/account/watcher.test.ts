import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CloudConnection } from './cloud.js'
import { OPENCODE } from '../opencode/name.js'
import { AccountHomes } from './homes.js'
import type { KeyVerdict } from './keycheck.js'
import type { BalanceVerdict } from './management.js'
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

  it("shows what is left of the key's own limit, by the hourly check and by a read between checks (BTN-847)", async () => {
    const at = '2026-10-26T12:00:00.000Z'
    const { accounts, options } = await watcher(() => ({ state: 'ok', limit: { remaining: 7.5, limit: 10, reset: 'monthly' } }))
    expect(accounts.view.accounts[0]?.keyLimit).toEqual({ remaining: 7.5, limit: 10, reset: 'monthly', at })
    let changes = 0
    options.onChange = () => void changes++
    accounts.noteKeyLimit('work', { remaining: 6, limit: 10, reset: 'monthly' })
    accounts.noteKeyLimit('work', { remaining: 6, limit: 10, reset: 'monthly' })
    expect(accounts.view.accounts[0]?.keyLimit).toEqual({ remaining: 6, limit: 10, reset: 'monthly', at })
    expect(changes).toBe(1)
    accounts.noteKeyLimit('work', null)
    expect(accounts.view.accounts[0]).not.toHaveProperty('keyLimit')
    expect(changes).toBe(2)
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
      gcloud: () => ({ user: 'john', home: 'C:\Users\john', adcFile: 'C:\Users\john\AppData\Roaming\gcloud\application_default_credentials.json', adcType: null, environmentFile: null, projects: ['fake-project'] }),
      azure: () => ({ user: 'john', home: 'C:\\Users\\john', profileFile: 'C:\\Users\\john\\.azure\\azureProfile.json', signedIn: false, environment: false }),
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
  it("puts the service user's Google Cloud credentials into the view when the Vertex form asks", () => {
    const { accounts } = watcher(async () => ({ model: null }))
    expect(accounts.view.gcloud).toBeUndefined()
    accounts.readGcloud()
    expect(accounts.view.gcloud).toMatchObject({ user: 'john', adcType: null, projects: ['fake-project'] })
  })

  it("puts the service user's Azure sign-in into the view when the Foundry form asks (BTN-824)", () => {
    const { accounts } = watcher(async () => ({ model: null }))
    expect(accounts.view.azure).toBeUndefined()
    accounts.readAzure()
    expect(accounts.view.azure).toMatchObject({ user: 'john', signedIn: false, environment: false })
  })

  it('reads a connection error at the check of a Foundry account as an unreachable resource (BTN-824)', async () => {
    const { accounts } = watcher(async () => {
      throw new Error('API Error: Connection error. getaddrinfo ENOTFOUND wrong-name.services.ai.azure.com')
    })
    const foundry: CloudConnection = { cloud: 'foundry', endpoint: { resource: 'wrong-name' }, auth: { way: 'entra' }, models: { sonnet: 'my-sonnet' } }
    await expect(accounts.addCloud('', foundry)).rejects.toThrow(expect.objectContaining({ notice: { code: 'cloud.foundryUnreachable', params: {} } }))
  })
})

describe('AccountWatcher.setManagementKey (BTN-868)', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const ROUTER_KEY = 'sk-or-v1-session-fake-00000000000000'
  const MANAGEMENT = 'sk-or-v1-management-fake-0000000000'
  const refusal = (code: string) => expect.objectContaining({ notice: expect.objectContaining({ code }) })

  /** An OpenCode account `router` on an OpenRouter key and a Claude API account `work`; `balance` answers each read. */
  async function watcher(balance: (key: string) => BalanceVerdict, saved: Record<string, string> = {}) {
    root = mkdtempSync(join(tmpdir(), 'even-keel-watcher-'))
    const homes = new AccountHomes({ CLAUDE_CONFIG_DIR: join(root, 'no-global'), CODEX_HOME: join(root, 'no-codex') }, join(root, 'claude'), join(root, 'codex'), join(root, 'opencode'), join(root, 'copilot'))
    homes.addApiKey('router', ROUTER_KEY, OPENCODE)
    homes.addApiKey('work', OLD)
    const keys = new Map(Object.entries(saved))
    const read: string[] = []
    let now = new Date('2026-11-08T12:00:00.000Z')
    let changes = 0
    const options = {
      homes,
      agentOf: () => ({ authStatus: async () => API_STATUS }),
      apps: { list: () => [] },
      active: () => 'router',
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
      checkKey: async () => ({ state: 'ok' }),
      keyCheckMs: 60 * 60_000,
      checkCredit: async () => ({ state: 'unknown', reason: 'none' }),
      creditCheckMs: 60 * 60_000,
      organizations: { of: () => undefined, note: () => {}, forget: () => {} },
      managementKeys: {
        of: (key: string) => keys.get(key),
        save: (key: string, value: string) => void keys.set(key, value),
        forget: (key: string) => void keys.delete(key),
      },
      readBalance: async (key: string) => {
        read.push(key)
        return balance(key)
      },
      now: () => now,
      onChange: () => void changes++,
      onError: (error: unknown) => {
        throw error
      },
    } as unknown as AccountWatcherOptions
    const accounts = new AccountWatcher(options)
    await accounts.refresh()
    return { accounts, keys, read, changes: () => changes, later: (ms: number) => (now = new Date(now.getTime() + ms)) }
  }

  const entry = (accounts: AccountWatcher, key: string) => accounts.view.accounts.find((each) => each.key === key)

  it('marks only an account on an OpenRouter key as one that may have a management key', async () => {
    const { accounts } = await watcher(() => ({ state: 'ok', usd: 1 }))
    expect(entry(accounts, 'router')).toMatchObject({ managementKey: false })
    expect(entry(accounts, 'router')?.balance).toBeUndefined()
    expect(entry(accounts, 'work')?.managementKey).toBeUndefined()
  })

  it('keeps a key that reads the balance, shows the balance at once and never gives the page the key', async () => {
    const { accounts, keys, read } = await watcher(() => ({ state: 'ok', usd: 74.75 }))
    await accounts.setManagementKey('router', `  ${MANAGEMENT}  `)
    expect(read).toEqual([MANAGEMENT])
    expect(keys.get('router')).toBe(MANAGEMENT)
    expect(entry(accounts, 'router')).toMatchObject({ managementKey: true, balance: { usd: 74.75, at: '2026-11-08T12:00:00.000Z' } })
    expect(JSON.stringify(accounts.view)).not.toContain(MANAGEMENT)
  })

  it('writes nothing when OpenRouter refuses the key or cannot be asked', async () => {
    const refused = await watcher(() => ({ state: 'rejected' }))
    await expect(refused.accounts.setManagementKey('router', MANAGEMENT)).rejects.toThrow(refusal('account.managementKeyRejected'))
    expect(refused.keys.size).toBe(0)
    rmSync(root, { recursive: true, force: true })
    const silent = await watcher(() => ({ state: 'unknown', reason: 'HTTP 500' }))
    await expect(silent.accounts.setManagementKey('router', MANAGEMENT)).rejects.toThrow(refusal('account.managementKeyUnchecked'))
    expect(silent.keys.size).toBe(0)
    expect(entry(silent.accounts, 'router')?.balance).toBeUndefined()
  })

  it('refuses a management key for an account that is not on an OpenRouter key, or one that is gone', async () => {
    const { accounts, read } = await watcher(() => ({ state: 'ok', usd: 1 }))
    await expect(accounts.setManagementKey('work', MANAGEMENT)).rejects.toThrow(refusal('account.managementKeyNotOpenRouter'))
    await expect(accounts.setManagementKey('gone', MANAGEMENT)).rejects.toThrow(refusal('account.unknown'))
    expect(read).toEqual([])
  })

  it('removes the key and its balance on an empty value', async () => {
    const { accounts, keys, read } = await watcher(() => ({ state: 'ok', usd: 3 }), { router: MANAGEMENT })
    expect(entry(accounts, 'router')?.balance).toMatchObject({ usd: 3 })
    await accounts.setManagementKey('router', null)
    expect(keys.size).toBe(0)
    expect(entry(accounts, 'router')).toMatchObject({ managementKey: false })
    expect(entry(accounts, 'router')?.balance).toBeUndefined()
    expect(read).toEqual([MANAGEMENT])
  })

  it('reads the balance with the hourly key check and between checks, keeps it on an answer that tells nothing, marks a refused key', async () => {
    let answer: BalanceVerdict = { state: 'ok', usd: 9.5 }
    const { accounts, read, changes, later } = await watcher(() => answer, { router: MANAGEMENT })
    expect(read).toEqual([MANAGEMENT])
    expect(entry(accounts, 'router')?.balance).toEqual({ usd: 9.5, at: '2026-11-08T12:00:00.000Z' })
    answer = { state: 'unknown', reason: 'fetch failed' }
    const before = changes()
    later(60_000)
    await accounts.readBalance('router')
    expect(entry(accounts, 'router')?.balance).toEqual({ usd: 9.5, at: '2026-11-08T12:00:00.000Z' })
    expect(changes()).toBe(before)
    answer = { state: 'rejected' }
    await accounts.readBalance('router')
    expect(entry(accounts, 'router')?.balance).toEqual({ rejected: true, at: '2026-11-08T12:01:00.000Z' })
    expect(changes()).toBe(before + 1)
    await accounts.readBalance('work')
    expect(read).toHaveLength(3)
  })
})
