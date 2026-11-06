import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { claude } from './adapter.js'
import { ClaudeCli, liveRecords } from './cli.js'

vi.mock('./cli.js', async (original) => ({ ...await original<typeof import('./cli.js')>(), liveRecords: vi.fn() }))

const at = Date.parse('2026-11-06T10:39:42.123Z')
const dirs: string[] = []
beforeEach(() => {
  vi.mocked(liveRecords).mockReset().mockResolvedValue([])
  vi.spyOn(ClaudeCli.prototype, 'authStatus').mockResolvedValue({ loggedIn: false } as Awaited<ReturnType<ClaudeCli['authStatus']>>)
  vi.spyOn(ClaudeCli.prototype, 'version').mockResolvedValue('2.1.317 (Claude Code)\n')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function setup() {
  const log = vi.fn()
  const agent = claude.setup({ env: () => ({}), timeoutMs: 1000, workDir: '.temp/oauth-adapter', checkedCli: () => false, log, onCliChange: () => {} })
  return { agent, log }
}

async function home(key: string, global = false): Promise<AccountHome> {
  await mkdir('.temp', { recursive: true })
  const dir = await mkdtemp(join('.temp', 'oauth-adapter-'))
  dirs.push(dir)
  return { key, global, agent: 'claude', dir }
}

async function credentials(folder: AccountHome, present: boolean, time = at) {
  await writeFile(join(folder.dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: {
    accessToken: present ? 'fake-access-secret' : '', refreshToken: present ? 'fake-refresh-secret' : '',
    expiresAt: present ? at + 3600_000 : 0, refreshTokenExpiresAt: at + 20 * 86400_000,
  } }))
  await utimes(join(folder.dir, '.credentials.json'), new Date(time), new Date(time))
}

describe('Claude adapter OAuth observations', () => {
  it('keeps folders separate, including global, and logs one emptying with already read peers', async () => {
    const { agent, log } = setup()
    const global = await home('global', true)
    const spare = await home('spare')
    await credentials(global, true)
    await credentials(spare, true)
    await agent.authStatus(global)
    await agent.authStatus(spare)
    expect(log).not.toHaveBeenCalled()
    expect(ClaudeCli.prototype.version).not.toHaveBeenCalled()
    expect(liveRecords).not.toHaveBeenCalled()
    vi.mocked(liveRecords).mockResolvedValue([{ pid: 123 }, { pid: 456 }] as Awaited<ReturnType<typeof liveRecords>>)
    await credentials(spare, false, at + 2000)
    await Promise.all([agent.authStatus(spare), agent.authStatus(spare)])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('account: spare: the CLI emptied the OAuth tokens at 2026-11-06T10:39:44.123Z')
    expect(log.mock.calls[0][0]).toContain('CLI 2.1.317; live sessions: 123, 456; other folders changed within 5 s: global')
    expect(liveRecords).toHaveBeenCalledWith(spare)
    expect(ClaudeCli.prototype.authStatus).toHaveBeenCalledTimes(4)
    expect(JSON.stringify(log.mock.calls)).not.toContain('fake-access-secret')
    expect(JSON.stringify(log.mock.calls)).not.toContain('fake-refresh-secret')
  })

  it('keeps the previous valid shape across a bad file and preserves auth errors', async () => {
    const { agent, log } = setup()
    const folder = await home('test')
    await credentials(folder, true)
    await agent.authStatus(folder)
    await writeFile(join(folder.dir, '.credentials.json'), '{')
    await agent.authStatus(folder)
    expect(log).not.toHaveBeenCalled()
    await credentials(folder, false)
    vi.mocked(ClaudeCli.prototype.authStatus).mockRejectedValue(new Error('fake-auth-error'))
    await expect(agent.authStatus(folder)).rejects.toThrow('fake-auth-error')
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('the CLI emptied')
  })

  it('still checks auth if diagnostics fail, and starts a fresh baseline after restart', async () => {
    const { agent, log } = setup()
    const folder = await home('test')
    await credentials(folder, true)
    await agent.authStatus(folder)
    await credentials(folder, false)
    vi.mocked(liveRecords).mockRejectedValue(new Error('fake-session-error'))
    vi.mocked(ClaudeCli.prototype.version).mockRejectedValue(new Error('fake-version-error'))
    await agent.authStatus(folder)
    await agent.authStatus(folder)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('CLI unknown; live sessions: unknown')
    const restarted = setup()
    await restarted.agent.authStatus(folder)
    await restarted.agent.authStatus(folder)
    expect(restarted.log.mock.calls).toEqual([['account: test: OAuth tokens empty since 2026-11-06T10:39:42.123Z']])
  })
})
