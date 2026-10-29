import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnRegistry } from '../codex/turns.js'
import { OpenCodeCli, LOGIN_METHODS, sessionConfig, writeConfig } from './cli.js'
import { sessionRows } from './db.js'

vi.mock('./db.js', () => ({ sessionRows: vi.fn() }))
const dirs: string[] = []
afterEach(() => { vi.resetAllMocks(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })

function account(providers: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'ek-opencode-support-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'data', 'opencode'), { recursive: true })
  writeFileSync(join(dir, 'data', 'opencode', 'auth.json'), JSON.stringify(Object.fromEntries(providers.map(provider => [provider, { type: 'oauth' }]))))
  const home = { key: 'demo', agent: 'opencode', dir, global: false }
  const registry = new TurnRegistry(join(dir, 'turns'))
  const binary = vi.fn(() => { throw new Error('must not spawn OpenCode') })
  const cli = new OpenCodeCli(binary, 100, () => ({}), registry)
  const start = { name: 'DEMO-1', cwd: dir, prompt: 'Continue', model: null as string | null }
  return { home, registry, binary, cli, start }
}

describe('OpenCode without Copilot execution', () => {
  it.each([null, 'opencode/big-pickle', 'github-copilot/gpt-6.1'])('refuses launch, resume and one-turn writing on a Copilot-only folder with model %s', async model => {
    const { cli, home, start, binary } = account(['github-copilot'])
    const refusal = expect.objectContaining({ notice: { code: 'chain.opencodeCopilot', params: {} } })
    await expect(cli.launch(home, { ...start, model })).rejects.toThrow(refusal)
    await expect(cli.resume(home, 'ses_demo', { ...start, model })).rejects.toThrow(refusal)
    await expect(cli.write(home, { ...start, model, timeoutMs: 100 })).rejects.toThrow(refusal)
    expect(binary).not.toHaveBeenCalled()
  })

  it('refuses an explicit Copilot model on a mixed folder and refuses that login method', async () => {
    const { cli, home, start, binary } = account(['github-copilot', 'openai'])
    await expect(cli.launch(home, { ...start, model: 'github-copilot/gpt-6.1' })).rejects.toThrow(expect.objectContaining({ notice: { code: 'chain.opencodeCopilot', params: {} } }))
    expect(() => cli.login(home, 'copilot')).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'login.method' }) }))
    expect(LOGIN_METHODS).not.toHaveProperty('copilot')
    expect(binary).not.toHaveBeenCalled()
  })

  it('refuses a resume inheriting a saved Copilot model before stopping or spawning a turn', async () => {
    const { cli, home, start, registry, binary } = account(['github-copilot', 'openai'])
    registry.save({ sessionId: 'ses_demo', name: start.name, cwd: start.cwd, account: home.key, startedAt: 1, pid: 0, out: registry.turnFile(start.name, 1) })
    vi.mocked(sessionRows).mockResolvedValue({ messages: [{ id: 'm1', at: 1, data: JSON.stringify({ role: 'assistant', modelID: 'gpt-6.1', providerID: 'github-copilot' }) }], parts: [], stamp: 1 })
    await expect(cli.resume(home, 'ses_demo', start)).rejects.toThrow(expect.objectContaining({ notice: { code: 'chain.opencodeCopilot', params: {} } }))
    expect(binary).not.toHaveBeenCalled()
  })

  it('disables the provider for implicit defaults as well as explicit model checks', () => {
    expect(JSON.parse(sessionConfig({}, [], [])).disabled_providers).toEqual(['github-copilot'])
    expect(JSON.parse(writeConfig([])).disabled_providers).toEqual(['github-copilot'])
  })
})
