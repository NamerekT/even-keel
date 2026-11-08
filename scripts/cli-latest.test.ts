import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isMuslLinux } from '../src/agent/npm.js'
import { claude } from '../src/claude/adapter.js'
import { fetchClaude } from '../src/claude/release.js'
import { fetchSdk } from '../src/claude/sdk/release.js'
import { fetchCodex } from '../src/codex/release.js'
import { CODEX_CHECKED } from '../src/codex/version.js'
import { opencode } from '../src/opencode/adapter.js'
import { fetchOpenCode, openCodePackage } from '../src/opencode/release.js'
import { claudeCode, claudeSdk } from '../src/e2e-cli/claude.fixture.js'
import { codex } from '../src/e2e-cli/codex.fixture.js'
import { openCode } from '../src/e2e-cli/opencode.fixture.js'
import { cliVersion } from '../src/e2e-cli/kit.fixture.js'
import { latestTarget, resolveLatest } from '../src/e2e-cli/latest.fixture.js'

vi.mock('../src/claude/release.js', async (original) => ({ ...await original<object>(), fetchClaude: vi.fn(async () => {}) }))
vi.mock('../src/claude/sdk/release.js', async (original) => ({ ...await original<object>(), fetchSdk: vi.fn(async () => {}) }))
vi.mock('../src/codex/release.js', async (original) => ({ ...await original<object>(), fetchCodex: vi.fn(async () => {}) }))
vi.mock('../src/opencode/release.js', async (original) => ({ ...await original<object>(), fetchOpenCode: vi.fn(async () => {}) }))

let dir: string
beforeEach(() => {
  mkdirSync('.temp', { recursive: true })
  dir = mkdtempSync(join('.temp', 'cli-latest-unit-'))
  vi.stubEnv('EVEN_KEEL_E2E_CLI_DIR', dir)
  vi.stubEnv('EVEN_KEEL_E2E_CLI_VERSION', undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('the real CLI version', () => {
  it('defaults to checked and refuses an explicitly empty or invalid override', () => {
    expect(cliVersion('1.2.3')).toBe('1.2.3')
    for (const version of ['', 'latest', '../2.3.4', '2.3', '2.3.4\n']) {
      vi.stubEnv('EVEN_KEEL_E2E_CLI_VERSION', version)
      expect(() => cliVersion('1.2.3')).toThrow(/EVEN_KEEL_E2E_CLI_VERSION/)
    }
  })

  it.each([
    { kit: claudeCode, checked: claude.checked, fetch: fetchClaude },
    { kit: codex, checked: CODEX_CHECKED, fetch: fetchCodex },
    { kit: openCode, checked: opencode.checked, fetch: fetchOpenCode },
  ])('downloads the selected version into its own folder for $kit.title', async ({ kit, checked, fetch }) => {
    const pinned = await kit.binary()
    expect(fetch).toHaveBeenLastCalledWith(checked, expect.stringContaining(join(kit.agent, checked)))
    vi.stubEnv('EVEN_KEEL_E2E_CLI_VERSION', '99.88.77')
    const latest = await kit.binary()
    expect(fetch).toHaveBeenLastCalledWith('99.88.77', expect.stringContaining(join(kit.agent, '99.88.77')))
    expect(latest).not.toBe(pinned)
  })

  it('keeps the SDK and its CLI on checked even with an override', async () => {
    vi.stubEnv('EVEN_KEEL_E2E_CLI_VERSION', '99.88.77')
    await claudeSdk.binary()
    expect(fetchClaude).toHaveBeenCalledWith(claude.checked, expect.stringContaining(join('claude', claude.checked)))
    expect(fetchSdk).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('claude-sdk'))
  })
})

describe('latest CLI discovery', () => {
  it.each([
    [CODEX_CHECKED, 'false'],
    ['99.88.77', 'true'],
    ['0.0.1', 'true'],
  ])('runs only when latest %s differs from checked', async (latest, run) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ latest })))
    const output = vi.fn()
    await resolveLatest('codex', output)
    expect(output.mock.calls).toEqual([['checked', CODEX_CHECKED], ['latest', latest], ['run', run]])
  })

  it('reports checked before a failed lookup and never permits the scenarios', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const output = vi.fn()
    await expect(resolveLatest('codex', output)).rejects.toThrow('offline')
    expect(output.mock.calls).toEqual([['checked', CODEX_CHECKED]])
  })

  it.each([
    ['claude', claude.checked, 'downloads.claude.ai/claude-code-releases/latest', false],
    ['codex', CODEX_CHECKED, 'registry.npmjs.org/-/package/@openai/codex/dist-tags', true],
    ['opencode', opencode.checked, `registry.npmjs.org/-/package/${openCodePackage(process.platform, process.arch, isMuslLinux())}/dist-tags`, true],
  ])('uses the release source and checked version of %s', async (cli, checked, source, npm) => {
    const fetch = vi.fn(async () => npm ? Response.json({ latest: '99.88.77' }) : new Response('99.88.77'))
    vi.stubGlobal('fetch', fetch)
    const target = latestTarget(cli)
    expect(target.checked).toBe(checked)
    expect(await target.latest()).toBe('99.88.77')
    expect(fetch).toHaveBeenCalledWith(`https://${source}`, expect.any(Object))
  })

  it.each(['claude', 'codex', 'opencode'])('fails when %s returns missing data or the network fails', async (cli) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
    await expect(latestTarget(cli).latest()).rejects.toThrow(/version/)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(latestTarget(cli).latest()).rejects.toThrow('offline')
  })

  it('refuses unsupported CLIs, including the SDK', () => {
    for (const cli of [undefined, '', 'claude-sdk', 'copilot', 'unknown']) {
      expect(() => latestTarget(cli)).toThrow(/claude, codex or opencode/)
    }
  })
})
