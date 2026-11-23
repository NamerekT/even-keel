import { describe, expect, it } from 'vitest'
import type { BinaryMachine } from '../agent/npm-global.js'
import { cliReport, installedClis, systemBinary } from './cli-report.js'

const linux = (runnable: string[]): BinaryMachine => ({ platform: 'linux', arch: 'x64', home: '/home/node', runnable: (path) => runnable.includes(path) })

describe('the CLIs a machine reports', () => {
  it('finds a CLI in ~/.local/bin off the PATH, as the launch does', () => {
    expect(systemBinary('claude', { PATH: '/usr/local/bin:/usr/bin' }, linux(['/home/node/.local/bin/claude']))).toBe('/home/node/.local/bin/claude')
    expect(systemBinary('claude', { PATH: '/usr/bin' }, linux([]))).toBe('claude')
  })

  it('takes the binary EVEN_KEEL_<AGENT>_BIN names', () => {
    expect(systemBinary('codex', { EVEN_KEEL_CODEX_BIN: '/opt/codex/bin/codex' }, linux([]))).toBe('/opt/codex/bin/codex')
    expect(systemBinary('opencode', { EVEN_KEEL_OPENCODE_BIN: '/opt/opencode' }, linux([]))).toBe('/opt/opencode')
  })

  it('asks each installed CLI found that way, null for one that does not answer', async () => {
    const asked: string[] = []
    const clis = await installedClis({ EVEN_KEEL_CLAUDE_BIN: '/opt/claude' }, async (binary) => {
      asked.push(binary)
      return binary === '/opt/claude' ? '2.1.330 (Claude Code)\n' : null
    })
    expect(asked[0]).toBe('/opt/claude')
    expect(clis).toMatchObject({ claude: '2.1.330', codex: null, opencode: null })
  })

  it("names the copy's version while sessions run on it, with no installed CLI at all", () => {
    const report = cliReport([['claude', { installed: () => true, pinned: () => '2.1.301' }]], () => null)
    expect(report).toEqual({ claude: '2.1.301' })
  })

  it('names the installed version otherwise, and null where the CLI sessions would run on is not found', () => {
    const installed = { claude: '2.1.330', codex: '0.170.0' } as Record<string, string>
    const report = cliReport(
      [
        ['claude', { installed: () => true, pinned: () => null }],
        ['codex', { installed: () => false, pinned: () => null }],
        ['opencode', { installed: () => true }],
      ],
      (agent) => installed[agent] ?? null,
    )
    expect(report).toEqual({ claude: '2.1.330', codex: null, opencode: null })
  })
})
