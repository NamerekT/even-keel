import { describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { wireLaunchIn, wireResumeIn } from './accounts.js'

describe('project trust wiring', () => {
  it('reads current project consent inside the lease for launch and resume, including a changed account', async () => {
    const launch = vi.fn(async () => 'session')
    const resume = vi.fn(async () => 'session')
    const current = { projects: { p: 'D:/checkout' }, settings: { p: { trustClaude: false } } }
    const ctx = {
      configStore: { current },
      cliCopies: { blocked: () => null },
      protectionAudit: { check: async () => {} },
      requireModel: async () => {},
      agentOf: () => ({ launch, resume }),
      projectOf: () => 'p',
      cliLease: { session: async (_home: AccountHome, run: () => Promise<string>) => run() },
    } as unknown as Parameters<typeof wireLaunchIn>[0]
    const start = { name: 'ABC-1', cwd: 'D:/checkout/.claude/worktrees/abc-1', prompt: 'test', model: null }
    const first: AccountHome = { key: 'one', dir: 'D:/one', global: false, agent: 'claude' }
    const second = { ...first, key: 'two', dir: 'D:/two' }
    await wireLaunchIn(ctx)(first, start, 'p')
    expect(launch).toHaveBeenLastCalledWith(first, { ...start, trustedRepo: undefined })
    current.settings.p.trustClaude = true
    await wireResumeIn(ctx)(second, { agentId: 'job', sessionId: 'session' }, start)
    expect(resume).toHaveBeenLastCalledWith(second, { agentId: 'job', sessionId: 'session' }, { ...start, trustedRepo: 'D:/checkout' })
    current.settings.p.trustClaude = false
    await wireLaunchIn(ctx)(second, start, 'p')
    expect(launch).toHaveBeenLastCalledWith(second, { ...start, trustedRepo: undefined })
  })
})
