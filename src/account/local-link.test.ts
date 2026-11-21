import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountHomes, type AccountHome } from './homes.js'
import type { AccountStatus } from './model.js'
import { AccountWatcher, type AccountWatcherOptions } from './watcher.js'

const SIGNED_IN: AccountStatus = { loggedIn: true, email: 'john@example.com', authMethod: 'claude.ai', orgName: null, subscriptionType: 'max' }
const MANUAL = 'https://claude.ai/oauth/authorize?code=true&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback'
const LOCAL = 'https://claude.ai/oauth/authorize?code=true&redirect_uri=http%3A%2F%2Flocalhost%3A54321%2Fcallback'

let root: string
afterEach(() => rmSync(root, { recursive: true, force: true }))

function setup() {
  root = mkdtempSync(join(tmpdir(), 'even-keel-local-link-'))
  const homes = new AccountHomes({ CLAUDE_CONFIG_DIR: join(root, 'none'), CODEX_HOME: join(root, 'none-codex') }, join(root, 'claude'), join(root, 'codex'), join(root, 'opencode'), join(root, 'copilot'))
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() })
  let onLink: ((url: string) => void) | undefined
  const login = (_home: AccountHome, _method?: string, onLocalLink?: (url: string) => void) => {
    onLink = onLocalLink
    return child
  }
  const options = {
    homes, agentOf: () => ({ authStatus: async () => SIGNED_IN, login }), active: () => 'other',
    apps: { list: () => [] }, transportOf: () => null, nameOf: () => null, loginBlock: () => null,
    sessionsIn: () => [], projectsOn: () => [], pool: () => [], makeShared: vi.fn(), missing: () => [],
    online: async () => true, sessionsKnown: () => true, removing: () => false, configPending: () => false,
    limits: () => null, usage: () => ({ state: 'ok' }), loginTimeoutMs: 60_000,
    checkKey: async () => ({ state: 'ok' }), keyCheckMs: 60 * 60_000, checkCredit: async () => ({ state: 'unknown', reason: 'none' }), creditCheckMs: 60 * 60_000,
    organizations: { of: () => undefined, note: () => {}, forget: () => {} },
    now: () => new Date(), onChange: () => {}, onError: (error: unknown) => { throw error },
  } as unknown as AccountWatcherOptions
  return { accounts: new AccountWatcher(options), child, link: (url: string) => onLink?.(url) }
}

describe('the link that signs in on this computer (BTN-1292)', () => {
  it('keeps the CLI’s own link apart from the printed one', () => {
    const { accounts, child, link } = setup()
    accounts.add('claude')
    expect(accounts.view.login).not.toHaveProperty('localUrl')
    child.stdout.write(`Open this link to sign in:\n${MANUAL}\n`)
    link(LOCAL)
    expect(accounts.view.login).toMatchObject({ urls: [MANUAL], localUrl: LOCAL })
  })

  it('ignores a link of a sign-in that is already over', async () => {
    const { accounts, child, link } = setup()
    accounts.add('claude')
    accounts.cancel()
    link(LOCAL)
    expect(accounts.view.login).toBeNull()
    child.emit('close', 0)
    await vi.waitFor(() => expect(accounts.view.login).toBeNull())
  })
})
