import { describe, expect, it, vi } from 'vitest'
import { CliChecks, type CheckHistory } from './scheduler.js'
import { AccountLease } from './lease.js'

const home = { key: 'test', dir: 'D:/accounts/test', agent: 'claude', global: false }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

function setup(history: CheckHistory = {}) {
  const clock = { at: Date.parse('2026-10-01T00:00:00Z') }
  const config = { on: true, live: false, latest: '2.0.2' }
  const latest = vi.fn(async () => config.latest)
  const run = vi.fn(async () => {})
  const saved = vi.fn(async (_history: CheckHistory) => {})
  const lease = new AccountLease()
  const checks = new CliChecks({
    enabled: () => config.on, ready: () => true,
    agents: () => [{ name: 'claude', title: 'Claude Code', checked: '2.0.1', home }],
    latest, live: async () => config.live, run, lease, history,
    accountLabel: () => 'Test account', save: saved, now: () => clock.at, changed: () => {}, log: () => {},
  })
  return { checks, lease, clock, config, latest, run, saved, history }
}

describe('automatic CLI checks', () => {
  it('does no registry or account work when disabled', async () => {
    const ctx = setup(); ctx.config.on = false
    await ctx.checks.check()
    expect(ctx.latest).not.toHaveBeenCalled()
    expect(ctx.run).not.toHaveBeenCalled()
  })

  it('waits for a free folder, then tests each latest version only once across restarts', async () => {
    const ctx = setup(); ctx.config.live = true
    await ctx.checks.check()
    expect(ctx.run).not.toHaveBeenCalled()
    expect(ctx.checks.view()[0]?.notice).toMatchObject({ code: 'cliCheck.waiting', params: { account: 'Test account', version: '2.0.2' } })
    ctx.config.live = false
    await ctx.checks.check()
    expect(ctx.run).toHaveBeenCalledWith(expect.objectContaining({ version: '2.0.2', home }))
    const restarted = setup(ctx.history)
    await restarted.checks.check()
    expect(restarted.latest).not.toHaveBeenCalled()
    expect(restarted.run).not.toHaveBeenCalled()
    expect(restarted.checks.view()[0]?.notice.code).toBe('cliCheck.passed')
  })

  it('replaces an unstarted version with the newest release after six hours', async () => {
    const ctx = setup(); ctx.config.live = true
    await ctx.checks.check()
    ctx.config.latest = '2.0.3'; ctx.clock.at += 6 * 60 * 60_000
    await ctx.checks.check()
    ctx.config.live = false
    await ctx.checks.check()
    expect(ctx.run).toHaveBeenCalledOnce()
    expect(ctx.run.mock.calls[0]?.[0]).toMatchObject({ version: '2.0.3' })
  })

  it('runs the checked version every week even after a failed new-version check', async () => {
    const ctx = setup(); ctx.run.mockRejectedValueOnce(new Error('step: launch'))
    await ctx.checks.check()
    expect(ctx.checks.view()[0]?.notice).toMatchObject({ code: 'cliCheck.failed', detail: 'step: launch' })
    await ctx.checks.check()
    expect(ctx.run).toHaveBeenCalledOnce()
    ctx.clock.at += 7 * 24 * 60 * 60_000
    await ctx.checks.check()
    expect(ctx.run).toHaveBeenLastCalledWith(expect.objectContaining({ version: '2.0.1' }))
  })

  it('holds the folder through cleanup and prevents overlapping polls', async () => {
    const ctx = setup(); const gate = deferred()
    ctx.run.mockImplementation(async () => {
      expect(ctx.lease.held(home)).toBe(true)
      await gate.promise
    })
    const poll = ctx.checks.check()
    await vi.waitFor(() => expect(ctx.run).toHaveBeenCalledOnce())
    await expect(ctx.lease.session(home, async () => {})).rejects.toThrow()
    await ctx.checks.check()
    expect(ctx.run).toHaveBeenCalledOnce()
    gate.resolve(); await poll
    expect(ctx.lease.held(home)).toBe(false)
  })

  it('does not reserve an account during an in-flight session launch', async () => {
    const ctx = setup(); const gate = deferred()
    const launch = ctx.lease.session(home, () => gate.promise)
    await ctx.checks.check()
    expect(ctx.run).not.toHaveBeenCalled()
    gate.resolve(); await launch
    await ctx.checks.check()
    expect(ctx.run).toHaveBeenCalledOnce()
  })

  it('releases the folder after a failed check', async () => {
    const ctx = setup()
    ctx.run.mockRejectedValueOnce(new Error('cleanup failed'))
    await ctx.checks.check()
    expect(ctx.lease.held(home)).toBe(false)
    expect(ctx.checks.view()[0]?.notice.code).toBe('cliCheck.failed')
  })

  it('waits when the live sessions cannot be read, never taking that for a free folder', async () => {
    const ctx = setup()
    const checks = new CliChecks({
      enabled: () => true, ready: () => true,
      agents: () => [{ name: 'claude', title: 'Claude Code', checked: '2.0.1', home }],
      latest: async () => '2.0.2', live: async () => { throw new Error('no sessions') }, run: ctx.run, lease: ctx.lease, history: {},
      accountLabel: () => 'Test account', save: async () => {}, now: () => ctx.clock.at, changed: () => {}, log: () => {},
    })
    await checks.check()
    expect(ctx.run).not.toHaveBeenCalled()
    expect(ctx.lease.held(home)).toBe(false)
    expect(checks.view()[0]?.notice.code).toBe('cliCheck.waiting')
  })

  it('runs a check again that a stop of the service cut short', async () => {
    const at = Date.parse('2026-10-01T00:00:00Z')
    const ctx = setup({ claude: { polled: at, latest: '2.0.2', attempted: ['2.0.2'], weeklyAt: at, result: { version: '2.0.2', at, status: 'running' } } })
    expect(ctx.checks.view()[0]?.notice.code).toBe('cliCheck.interrupted')
    await ctx.checks.check()
    expect(ctx.run).toHaveBeenCalledWith(expect.objectContaining({ version: '2.0.2' }))
    expect(ctx.checks.view()[0]?.notice.code).toBe('cliCheck.passed')
  })
})
