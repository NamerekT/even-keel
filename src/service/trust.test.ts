import { describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { fail, noticeOf } from '../notice/notice.js'
import { wireLaunchIn, wireResumeIn } from './accounts.js'

describe('project trust wiring', () => {
  it.each(['launch', 'resume'] as const)('keeps the checkout and invocation that failed %s after settings change', async (method) => {
    const recovery = { binary: 'D:/checked/claude.exe', configDir: 'D:/accounts/one' }
    const current = { projects: { p: 'D:/checkout' } }
    const refuse = async () => {
      current.projects.p = 'D:/moved'
      throw fail(method === 'launch' ? 'claude.startFailed' : 'claude.resumeFailed', { task: 'ABC-1', cwd: 'D:/checkout', recovery }, { detail: 'Workspace not trusted' })
    }
    const ctx = {
      configStore: { current }, cliCopies: { blocked: () => null }, protectionAudit: { check: async () => {} },
      requireModel: async () => {}, agentOf: () => ({ launch: refuse, resume: refuse }), projectOf: () => 'p',
      cliLease: { session: async (_home: AccountHome, run: () => Promise<string>) => run() },
    } as unknown as Parameters<typeof wireLaunchIn>[0]
    const home: AccountHome = { key: 'one', dir: 'D:/accounts/one', agent: 'claude', global: false }
    const start = { name: 'ABC-1', cwd: 'D:/checkout', prompt: 'test', model: null }
    const call = method === 'launch' ? wireLaunchIn(ctx)(home, start, 'p') : wireResumeIn(ctx)(home, { agentId: 'job', sessionId: 'session' }, start)
    expect(noticeOf(await call.catch(error => error))).toMatchObject({ code: 'claude.untrusted', params: { folder: 'D:/checkout', recovery } })
  })

  it('trusts the current checkout inside the lease on every launch and resume, including a changed account', async () => {
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
    expect(launch).toHaveBeenLastCalledWith(first, { ...start, trustedRepo: 'D:/checkout' })
    current.settings.p.trustClaude = true
    await wireResumeIn(ctx)(second, { agentId: 'job', sessionId: 'session' }, start)
    expect(resume).toHaveBeenLastCalledWith(second, { agentId: 'job', sessionId: 'session' }, { ...start, trustedRepo: 'D:/checkout' })
    current.settings.p.trustClaude = false
    await wireLaunchIn(ctx)(second, start, 'p')
    expect(launch).toHaveBeenLastCalledWith(second, { ...start, trustedRepo: 'D:/checkout' })
    current.projects.p = 'D:/moved'
    await wireLaunchIn(ctx)(second, start, 'p')
    expect(launch).toHaveBeenLastCalledWith(second, { ...start, trustedRepo: 'D:/moved' })
    await wireLaunchIn(ctx)(second, start, undefined)
    expect(launch).toHaveBeenLastCalledWith(second, { ...start, trustedRepo: undefined })
  })
})
