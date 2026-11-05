import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fail, noticeOf } from '../notice/notice.js'
import { untrustedStart } from './trust.js'

const place = { task: 'GLS-4', folder: 'D:\\gls', platform: 'win32', user: 'svc', service: true }
const refusal =
  'Workspace not trusted. Run claude in D:\\gls\\.claude\\worktrees\\gls-4 once and accept the trust prompt, then retry.'

describe('untrustedStart', () => {
  it('carries the failed invocation context into the stored trust notice', () => {
    const recovery = { binary: 'D:/checked/claude.exe', configDir: 'D:/accounts/one' }
    const error = fail('claude.startFailed', { task: place.task, cwd: place.folder, recovery }, { detail: refusal })
    expect(noticeOf(untrustedStart(error, place))).toEqual({ code: 'claude.untrusted', params: { ...place, recovery } })
  })

  it("turns the CLI's refusal of an untrusted folder into a notice of its own, naming the project's folder (BTN-429)", () => {
    const error = fail('claude.startFailed', { task: 'GLS-4', cwd: 'D:\\gls\\.claude\\worktrees\\gls-4' }, { detail: `Error: ${refusal}\n` })
    expect(noticeOf(untrustedStart(error, place))).toEqual({ code: 'claude.untrusted', params: place })
  })

  it('writes a readable PowerShell script for the service user on Windows and names it in the notice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ek-trust-script-'))
    try {
      const recovery = { binary: "D:/checked cli/claude.exe", configDir: "D:/accounts/one's" }
      const error = fail('claude.startFailed', { task: place.task, cwd: place.folder, recovery }, { detail: refusal })
      const params = noticeOf(untrustedStart(error, place, dir)).params as { script?: string }
      expect(params.script).toBe(join(dir, 'trust', 'GLS-4.ps1'))
      expect(readFileSync(params.script!, 'utf8')).toBe([
        '\uFEFF$ErrorActionPreference = \'Stop\'',
        "Set-Location -LiteralPath 'D:\\gls'",
        "$env:CLAUDE_CONFIG_DIR = 'D:/accounts/one''s'",
        "& 'D:/checked cli/claude.exe'",
        '',
      ].join('\r\n'))
      const global = fail('claude.startFailed', { task: place.task, cwd: place.folder, recovery: { ...recovery, configDir: null } }, { detail: refusal })
      untrustedStart(global, place, dir)
      expect(readFileSync(params.script!, 'utf8')).toContain('Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes no script where the command needs none or cannot be built', () => {
    const recovery = { binary: 'D:/claude.exe', configDir: null }
    const error = fail('claude.startFailed', { task: place.task, cwd: place.folder, recovery }, { detail: refusal })
    const dir = mkdtempSync(join(tmpdir(), 'ek-trust-script-'))
    try {
      for (const [where, folder] of [[{ ...place, service: false }, dir], [{ ...place, platform: 'linux' }, dir], [place, undefined]] as const)
        expect(noticeOf(untrustedStart(error, where, folder)).params).not.toHaveProperty('script')
      const legacy = fail('claude.startFailed', { task: place.task, cwd: place.folder }, { detail: refusal })
      expect(noticeOf(untrustedStart(legacy, place, dir)).params).not.toHaveProperty('script')
      expect(existsSync(join(dir, 'trust'))).toBe(false)
      // A folder that cannot hold the script leaves the notice without it: the page falls back to the inline command.
      writeFileSync(join(dir, 'trust'), '')
      expect(noticeOf(untrustedStart(error, place, dir)).params).not.toHaveProperty('script')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves any other failure as it is', () => {
    expect(untrustedStart(fail('claude.startFailed', { task: 'GLS-4', cwd: 'D:\\gls' }, { detail: 'spawn ENOENT' }), place)).toBeNull()
    expect(noticeOf(untrustedStart(fail('claude.resumeFailed', { task: 'GLS-4', cwd: 'D:\\gls' }, { detail: refusal }), place)).code).toBe('claude.untrusted')
    expect(untrustedStart(new Error(refusal), place)).toBeNull()
  })
})
