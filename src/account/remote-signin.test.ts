import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountHomes, type AccountHome } from './homes.js'
import type { AccountStatus } from './model.js'
import { AccountWatcher, type AccountWatcherOptions } from './watcher.js'

const SIGNED_IN: AccountStatus = { loggedIn: true, email: 'john@example.com', authMethod: 'claude.ai', orgName: null, subscriptionType: 'max' }
const API_KEY = 'sk-ant-api03-FAKE0000000000000000000000000000-example'

let root: string
afterEach(() => rmSync(root, { recursive: true, force: true }))

function setup(status: (home: AccountHome) => AccountStatus = () => SIGNED_IN) {
  root = mkdtempSync(join(tmpdir(), 'even-keel-remote-signin-'))
  const homes = new AccountHomes({ CLAUDE_CONFIG_DIR: join(root, 'none'), CODEX_HOME: join(root, 'none-codex') }, join(root, 'claude'), join(root, 'codex'), join(root, 'opencode'), join(root, 'copilot'))
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() })
  const options = {
    homes, agentOf: () => ({ authStatus: async (home: AccountHome) => status(home), login: () => child }), active: () => 'other',
    apps: { list: () => [] }, transportOf: () => null, nameOf: () => null, loginBlock: () => null,
    sessionsIn: () => [], projectsOn: () => [], pool: () => [], makeShared: vi.fn(), missing: () => [],
    online: async () => true, sessionsKnown: () => true, removing: () => false, configPending: () => false,
    limits: () => null, usage: () => ({ state: 'ok' }), loginTimeoutMs: 60_000,
    checkKey: async () => ({ state: 'ok' }), keyCheckMs: 60 * 60_000, checkCredit: async () => ({ state: 'unknown', reason: 'none' }), creditCheckMs: 60 * 60_000,
    organizations: { of: () => undefined, note: () => {}, forget: () => {} },
    now: () => new Date(), onChange: () => {}, onError: (error: unknown) => { throw error },
  } as unknown as AccountWatcherOptions
  return { accounts: new AccountWatcher(options), homes, child }
}

const settingsOf = (home: AccountHome) => JSON.parse(readFileSync(join(home.dir, 'settings.json'), 'utf8')) as Record<string, unknown>

describe('Remote Control of a Claude account (EKR-148)', () => {
  it('turns Remote Control on in the folder of a new claude.ai sign-in', async () => {
    const { accounts, homes, child } = setup()
    accounts.add('claude')
    child.emit('close', 0)
    await vi.waitFor(() => expect(accounts.view.login).toBeNull())
    const [home] = homes.list()
    expect(settingsOf(home!).remoteControlAtStartup).toBe(true)
    expect(accounts.view.accounts[0]).not.toHaveProperty('remoteOff')
  })

  it('leaves it off for a sign-in Remote Control does not run on', async () => {
    const { accounts, homes, child } = setup(() => ({ ...SIGNED_IN, authMethod: 'oauth_token' }))
    accounts.add('claude')
    child.emit('close', 0)
    await vi.waitFor(() => expect(accounts.view.login).toBeNull())
    expect(homes.remoteOn(homes.list()[0]!)).toBe(false)
  })

  it('names a signed-in folder without it and turns it on by the button, keeping its other settings', async () => {
    const { accounts, homes } = setup()
    const home = homes.place(homes.pending(new Date(), 'claude'), 'john@example.com')
    writeFileSync(join(home.dir, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    await accounts.refresh()
    expect(accounts.view.accounts[0]).toMatchObject({ key: home.key, remoteOff: true })
    await accounts.enableRemote(home.key)
    expect(settingsOf(home)).toEqual({ theme: 'dark', remoteControlAtStartup: true })
    expect(accounts.view.accounts[0]).not.toHaveProperty('remoteOff')
  })

  it('offers nothing to an API account and refuses the button there', async () => {
    const { accounts, homes } = setup(() => ({ ...SIGNED_IN, authMethod: 'api_key', email: null }))
    const home = homes.addApiKey('work', API_KEY)
    await accounts.refresh()
    expect(accounts.view.accounts[0]).not.toHaveProperty('remoteOff')
    await expect(accounts.enableRemote(home.key)).rejects.toMatchObject({ notice: { code: 'account.remoteNoSignIn' } })
    expect(homes.remoteOn(home)).toBe(false)
  })
})
