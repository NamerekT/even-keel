import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { copilot } from './adapter.js'
import { TurnRegistry } from '../codex/turns.js'
import { eventsFile, writeToken } from './home.js'
import { machineToken } from './machine.js'
import { lampOf } from '../sessions/agents.js'

vi.mock('./machine.js', () => ({ machineToken: vi.fn(async () => null) }))

describe('Copilot adapter account access', () => {
  let workDir: string | undefined
  afterEach(() => {
    vi.clearAllMocks()
    vi.mocked(machineToken).mockReset().mockResolvedValue(null)
    vi.unstubAllGlobals()
    if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true })
  })

  it('keeps usage unavailable when the machine source cannot be read, and has no model hints', async () => {
    workDir = mkdtempSync(join(tmpdir(), 'copilot-adapter-'))
    const agent = copilot.setup({
      env: () => ({}),
      timeoutMs: 1000,
      workDir,
      checkedCli: () => false,
      log: () => {},
      onCliChange: () => {},
    })
    const home: AccountHome = { key: 'copilot', dir: workDir, global: false, agent: 'copilot' }
    const usage = agent.usage
    if (usage === undefined) throw new Error('Copilot adapter must expose usage')

    await expect(usage(home, '2026-10-28T00:00:00.000Z')).resolves.toMatchObject({
      kind: 'missing',
      reason: { code: 'usage.copilotMachine' },
    })
    expect(agent.models).toBeUndefined()
  })

  it.each([false, true])('reads the allowance with the folder token before consulting the machine: %s', async (ownToken) => {
    workDir = mkdtempSync(join(tmpdir(), 'copilot-usage-'))
    if (ownToken) writeToken(workDir, 'gho_folder')
    vi.mocked(machineToken).mockResolvedValueOnce('gho_machine')
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 120, unlimited: false } },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchImpl)
    const agent = copilot.setup({
      env: () => ({ EVEN_KEEL_COPILOT_BIN: '/checked/copilot', GH_TOKEN: 'gho_inherited' }),
      timeoutMs: 1000, workDir, checkedCli: () => false, log: () => {}, onCliChange: () => {},
    })
    const home: AccountHome = { key: 'copilot', dir: workDir, global: false, agent: 'copilot' }
    expect(await agent.usage!(home, '2026-10-29T00:00:00Z')).toMatchObject({ kind: 'limits', limits: { month: { left: 120 } } })
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith('https://api.github.com/copilot_internal/user', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: ownToken ? 'Bearer gho_folder' : 'token gho_machine' }),
    }))
    if (ownToken) expect(machineToken).not.toHaveBeenCalled()
    else expect(machineToken).toHaveBeenCalledWith('/checked/copilot', expect.objectContaining({ COPILOT_HOME: workDir }), workDir, 1000)
    const machineEnv = vi.mocked(machineToken).mock.calls[0]?.[1]
    expect(machineEnv?.GH_TOKEN).toBeUndefined()
  })

  it.each([false, true])('shows a terminal model refusal with a transcript present: %s', async (transcript) => {
    workDir = mkdtempSync(join(tmpdir(), 'copilot-refusal-'))
    const home: AccountHome = { key: 'copilot', dir: join(workDir, 'home'), global: false, agent: 'copilot' }
    const registry = new TurnRegistry(join(workDir, 'copilot'))
    const out = registry.turnFile('DEMO-1', Date.now())
    const message = 'Error: Model "missing-model" from --model flag is not available.'
    writeFileSync(out, `${JSON.stringify({ type: 'session.mcp_server_status_changed' })}\n${message}\n`)
    registry.save({ sessionId: 'refused', name: 'DEMO-1', cwd: workDir, account: home.key, startedAt: Date.now() - 1000, pid: 2147483647, out })
    if (transcript) {
      const file = eventsFile(home.dir, 'refused')
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, JSON.stringify({ type: 'session.start', timestamp: '2026-01-01T00:00:00Z', data: {} }) + '\n')
    }
    const agent = copilot.setup({ env: () => ({}), timeoutMs: 1000, workDir, checkedCli: () => false, log: () => {}, onCliChange: () => {} })
    expect(await agent.transcripts(home)).toContain('refused')
    const entry = (await agent.sessions(home))[0]!
    const tail = agent.tail(home, entry)
    await tail.read()
    const summary = tail.summary()
    expect(summary.apiError).toMatchObject({ kind: 'error', text: message, notice: { code: 'copilot.modelUnavailable', params: { model: 'missing-model' } } })
    expect(lampOf(entry, summary.apiError?.kind ?? null)).toBe('error')
    expect(summary.lastActivityAt).not.toBeNull()
    expect(summary.feed.at(-1)).toMatchObject({ kind: 'error', text: message })
    expect(await agent.record(home, 'refused')).toMatchObject({ apiError: message, apiErrorNotice: { code: 'copilot.modelUnavailable' } })
    expect(await agent.feed(home, 'refused', 0)).toMatchObject({ lines: summary.feed })
    expect(await agent.feed(home, 'refused', summary.feed.length)).toMatchObject({ lines: [] })

    // A new turn replaces the failed output; the old refusal must leave even a reused tail.
    const next = registry.turnFile('DEMO-1', Date.now() + 1)
    writeFileSync(next, '')
    registry.save({ sessionId: 'refused', name: 'DEMO-1', cwd: workDir, account: home.key, startedAt: Date.now() - 1000, pid: process.pid, out: next })
    tail.follow((await agent.sessions(home))[0]!)
    await tail.read()
    expect(tail.summary().apiError).toBeNull()
  })
})
