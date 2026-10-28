import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountHomes } from './homes.js'
import { AccountWatcher, type AccountWatcherOptions } from './watcher.js'

let root: string
afterEach(() => rmSync(root, { recursive: true, force: true }))

function setup(loggedIn = true) {
  root = mkdtempSync(join(tmpdir(), 'even-keel-global-choice-'))
  const dir = join(root, '.codex')
  mkdirSync(dir)
  const homes = new AccountHomes({ CLAUDE_CONFIG_DIR: join(root, 'none'), CODEX_HOME: dir }, join(root, 'claude'), join(root, 'codex'), join(root, 'opencode'), join(root, 'copilot'))
  const authStatus = vi.fn(async () => ({ loggedIn, email: 'john@example.com', authMethod: 'chatgpt', orgName: null, subscriptionType: 'plus' }))
  const logout = vi.fn()
  const makeShared = vi.fn()
  const options = {
    homes, agentOf: () => ({ authStatus, logout }), active: () => 'other',
    apps: { list: () => [] }, transportOf: () => null, nameOf: () => null, loginBlock: () => null,
    sessionsIn: () => [], projectsOn: () => [], pool: () => [{ provider: 'codex', account: 'codex', project: null }],
    makeShared, missing: () => [], online: async () => true, sessionsKnown: () => true,
    removing: () => false, configPending: () => false, limits: () => null, usage: () => ({ state: 'ok' }),
    now: () => new Date(), onChange: () => {}, onError: (error: unknown) => { throw error },
    forget: vi.fn(), organizations: { forget: vi.fn() },
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

it('removes a global account without logging out or deleting the CLI folder', async () => {
  const { accounts, homes, logout, options } = setup()
  await accounts.useGlobal('codex')
  options.pool = () => []
  await accounts.remove('codex')
  expect(accounts.view.accounts).toEqual([])
  expect(homes.availableGlobals().map((home) => home.key)).toEqual(['codex'])
  expect(logout).not.toHaveBeenCalled()
})
