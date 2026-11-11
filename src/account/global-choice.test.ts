import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { parseConfig, poolEntries, projectsByAccount } from '../config.js'
import { AccountHomes } from './homes.js'
import { AccountWatcher, type AccountWatcherOptions } from './watcher.js'
import type { AccountHome } from './homes.js'

let root: string
afterEach(() => rmSync(root, { recursive: true, force: true }))

function setup(loggedIn = true) {
  root = mkdtempSync(join(tmpdir(), 'even-keel-global-choice-'))
  const dir = join(root, '.codex')
  mkdirSync(dir)
  const homes = new AccountHomes({ CLAUDE_CONFIG_DIR: join(root, 'none'), CODEX_HOME: dir }, join(root, 'claude'), join(root, 'codex'), join(root, 'opencode'), join(root, 'copilot'))
  const authStatus = vi.fn(async () => ({ loggedIn, email: 'john@example.com', authMethod: 'chatgpt', orgName: null, subscriptionType: 'plus' }))
  const logout = vi.fn(async () => {})
  const makeShared = vi.fn()
  const options = {
    homes, agentOf: () => ({ authStatus, logout }), active: () => 'other',
    apps: { list: () => [] }, transportOf: () => null, nameOf: () => null, loginBlock: () => null,
    sessionsIn: () => [], projectsOn: () => [], pool: () => [{ provider: 'codex', account: 'codex', project: null }],
    makeShared, missing: () => [], online: async () => true, sessionsKnown: () => true,
    removing: () => false, configPending: () => false, limits: () => null, usage: () => ({ state: 'ok' }),
    now: () => new Date(), onChange: () => {}, onError: (error: unknown) => { throw error },
    forget: vi.fn(), organizations: { forget: vi.fn() }, managementKeys: { forget: vi.fn() },
  } as unknown as AccountWatcherOptions
  return { accounts: new AccountWatcher(options), authStatus, logout, makeShared, options, homes }
}

it('does not check hidden folders until Add account asks, and offers the signed-in identity without adding it', async () => {
  const { accounts, authStatus } = setup()
  await accounts.refresh()
  expect(authStatus).not.toHaveBeenCalled()
  expect(accounts.view.accounts).toEqual([])
  expect(accounts.view.pool).toEqual([])
  await accounts.discoverGlobal('codex')
  expect(accounts.view.globalCheck).toMatchObject({ agent: 'codex', account: { key: 'codex', status: { email: 'john@example.com' } } })
  expect(accounts.view.accounts).toEqual([])
})

it('adds the CLI folder explicitly and gives the first account its shared pool entry', async () => {
  const { accounts, makeShared } = setup()
  await accounts.useGlobal('codex')
  expect(accounts.view.accounts.map((entry) => entry.key)).toEqual(['codex'])
  expect(makeShared).toHaveBeenCalledWith('codex', 'codex')
})

it('skips the choice without a CLI sign-in and refuses a stale choice', async () => {
  const { accounts } = setup(false)
  await accounts.discoverGlobal('codex')
  expect(accounts.view.globalCheck).toEqual({ agent: 'codex', account: null })
  await expect(accounts.useGlobal('codex')).rejects.toThrow()
  expect(accounts.view.accounts).toEqual([])
})

it('refuses to register a second free Codex account', async () => {
  const { accounts, authStatus, homes, makeShared } = setup()
  authStatus.mockResolvedValue({ loggedIn: true, email: 'john@example.com', authMethod: 'chatgpt', orgName: null, subscriptionType: 'free' })
  const pending = homes.pending(new Date(), 'codex')
  homes.place(pending, 'other@example.com')
  await accounts.refresh()
  await expect(accounts.useGlobal('codex')).rejects.toMatchObject({ notice: { code: 'account.sameFree' } })
  expect(homes.find('codex')).toBeUndefined()
  expect(makeShared).not.toHaveBeenCalled()
})

it.each([
  ['codex', 'jane@example.com', 'free', true],
  ['opencode', 'jane@example.com', 'free', true],
  ['codex', 'john@example.com', 'free', false],
  ['codex', 'jane@example.com', 'plus', false],
])('adds OpenCode after %s with e-mail %s and plan %s (refused: %s)', async (existingAgent, email, plan, refused) => {
  const { accounts, homes, options, logout, makeShared } = setup()
  const first = homes.place(homes.pending(new Date(), existingAgent as string), 'john@example.com')
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() })
  options.loginTimeoutMs = 60_000
  options.agentOf = (() => ({
    authStatus: async (home: AccountHome) => ({
      loggedIn: true, email: home.key === first.key ? 'john@example.com' : email, orgName: null,
      authMethod: home.agent === 'codex' ? 'chatgpt' : 'oauth',
      subscriptionType: home.agent === 'codex' ? 'free' : 'openai',
      ...(home.agent === 'opencode' ? { chatgptPlan: home.key === first.key ? 'free' : plan } : {}),
    }),
    logout, login: () => child,
  })) as never
  await accounts.refresh()
  accounts.add('opencode', 'chatgpt')
  child.emit('close', 0)
  if (refused) {
    await vi.waitFor(() => expect(accounts.view.login?.error?.code).toBe('account.secondFree'))
    expect(logout).toHaveBeenCalledOnce()
    expect(homes.list().map(home => home.key)).toEqual([first.key])
    expect(makeShared).not.toHaveBeenCalled()
  } else {
    await vi.waitFor(() => expect(accounts.view.login).toBeNull())
    expect(homes.list()).toHaveLength(2)
    expect(logout).not.toHaveBeenCalled()
    expect(makeShared).toHaveBeenCalledWith('opencode', expect.any(String))
  }
})

it('removes a global account without logging out or deleting the CLI folder', async () => {
  const { accounts, homes, logout, options } = setup()
  await accounts.useGlobal('codex')
  options.pool = () => []
  await accounts.remove('codex')
  expect(accounts.view.accounts).toEqual([])
  expect(homes.availableGlobals().map((home) => home.key)).toEqual(['codex'])
  expect(logout).not.toHaveBeenCalled()
})

it('removes the only global account the built-in shared pool names, and the next account added takes its entry', async () => {
  const { accounts, homes, makeShared, options } = setup()
  const config = parseConfig({ projects: [], provider: 'copilot', accounts: { copilot: 'copilot' } })
  options.pool = () => poolEntries(config, [])
  await accounts.useGlobal('codex')
  expect(makeShared).toHaveBeenLastCalledWith('codex', 'codex')
  await accounts.remove('codex')
  expect(accounts.view.accounts).toEqual([])
  makeShared.mockClear()
  await accounts.useGlobal('codex')
  expect(homes.list().map((home) => home.key)).toEqual(['codex'])
  expect(makeShared).toHaveBeenCalledWith('codex', 'codex')
})

it('keeps a global account a project runs on through the built-in shared pool', async () => {
  const { accounts, options } = setup()
  const project = { id: 'f00d-1', key: 'ABC', repo: 'C:\\abc', tracker: 'huly', provider: 'codex' }
  const config = parseConfig({ projects: [project], provider: 'copilot', accounts: { copilot: 'copilot' } })
  options.pool = () => poolEntries(config, [project.id])
  options.projectsOn = (key) => projectsByAccount(config, [project.id])[key] ?? []
  await accounts.useGlobal('codex')
  await expect(accounts.remove('codex')).rejects.toMatchObject({ notice: { code: 'account.projectPool', params: { agent: 'codex', projects: [project.id] } } })
})
