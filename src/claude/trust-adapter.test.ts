import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { PinnedCli } from '../agent/pinned.js'
import { claude } from './adapter.js'
import { ClaudeCli } from './cli.js'
import { SdkSessions } from './sdk/host.js'
import { trustFolder } from './trust.js'

vi.mock('./trust.js', () => ({ trustFolder: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

const home: AccountHome = { key: 'test', dir: 'D:/test-account', agent: 'claude', global: false }
const start = { name: 'ABC-1', cwd: 'D:/repo/.claude/worktrees/abc-1', prompt: 'test', model: null, trustedRepo: 'D:/repo' }
const session = { agentId: 'job', sessionId: 'session' }

function setup(sdk = false, baseEnv: NodeJS.ProcessEnv = {}) {
  vi.mocked(trustFolder).mockClear()
  vi.spyOn(PinnedCli.prototype, 'path').mockReturnValue('D:/fake/claude.exe')
  vi.spyOn(SdkSessions.prototype, 'ready').mockReturnValue(true)
  vi.spyOn(SdkSessions.prototype, 'knows').mockResolvedValue(sdk)
  const launch = vi.spyOn(ClaudeCli.prototype, 'launch').mockImplementation(async () => {
    expect(trustFolder).toHaveBeenCalledWith(join(home.dir, '.claude.json'), 'D:/repo')
    return { sessionId: 'session' } as Awaited<ReturnType<ClaudeCli['launch']>>
  })
  const resume = vi.spyOn(ClaudeCli.prototype, 'resume').mockImplementation(async () => {
    expect(trustFolder).toHaveBeenCalledWith(join(home.dir, '.claude.json'), 'D:/repo')
    return { sessionId: 'session' } as Awaited<ReturnType<ClaudeCli['resume']>>
  })
  const agent = claude.setup({ env: () => baseEnv, timeoutMs: 1000, workDir: '.temp/trust-adapter', checkedCli: () => true, log: () => {}, onCliChange: () => {}, transport: () => sdk ? 'sdk' : 'bg' })
  return { agent, launch, resume }
}

describe('Claude trust at the transport boundary', () => {
  it('writes the launching account before every background launch and resume', async () => {
    const { agent } = setup()
    await agent.launch(home, start)
    await agent.resume(home, session, start)
    expect(trustFolder).toHaveBeenCalledTimes(2)
  })

  it('does not invent a checkout for a session outside a project', async () => {
    const { agent, launch } = setup()
    launch.mockResolvedValue({ sessionId: 'session' } as Awaited<ReturnType<ClaudeCli['launch']>>)
    await agent.launch(home, { ...start, trustedRepo: undefined })
    expect(trustFolder).not.toHaveBeenCalled()
  })

  it('routes an SDK resume by the session even if new launches use bg', async () => {
    const { agent } = setup()
    vi.mocked(SdkSessions.prototype.knows).mockResolvedValue(true)
    vi.spyOn(SdkSessions.prototype, 'resume').mockResolvedValue('session')
    await agent.resume(home, session, start)
    expect(trustFolder).not.toHaveBeenCalled()
  })

  it('leaves SDK launches alone', async () => {
    const { agent } = setup(true)
    vi.spyOn(SdkSessions.prototype, 'launch').mockResolvedValue('session')
    await agent.launch(home, start)
    expect(trustFolder).not.toHaveBeenCalled()
  })

  it.each([undefined, 'D:/override'])('uses the global config with override %s', async (override) => {
    const { agent, launch } = setup(false, override === undefined ? {} : { CLAUDE_CONFIG_DIR: override })
    launch.mockResolvedValue({ sessionId: 'session' } as Awaited<ReturnType<ClaudeCli['launch']>>)
    await agent.launch({ ...home, global: true, dir: override ?? join(homedir(), '.claude') }, start)
    expect(trustFolder).toHaveBeenCalledWith(override === undefined ? join(homedir(), '.claude.json') : join(override, '.claude.json'), 'D:/repo')
  })
})
