import { describe, expect, it, vi } from 'vitest'
import { checkDownloads, checkedVersion, type DownloadCheck } from './cli-fetch-support.js'

describe('CLI download checks', () => {
  it('requires an exact version token, including when the CLI prints a banner', () => {
    expect(checkedVersion('GitHub Copilot CLI 1.0.98\nBuild: abc', '1.0.98')).toBe('GitHub Copilot CLI 1.0.98 Build: abc')
    expect(() => checkedVersion('1.0.980', '1.0.98')).toThrow('expected 1.0.98')
    expect(() => checkedVersion('1.0.98-preview', '1.0.98')).toThrow('expected 1.0.98')
    expect(() => checkedVersion('', '1.0.98')).toThrow('empty version output')
  })

  it('reports failures and still checks later downloads, while unsupported targets are skipped', async () => {
    const unsupported = vi.fn()
    const later = vi.fn().mockResolvedValue('2.1.310')
    const checks: DownloadCheck[] = [
      { agent: 'broken', version: '1.0.0', target: 'package', check: async () => { throw new Error('HTTP 404') } },
      { agent: 'unsupported', version: '1.0.0', target: null, check: unsupported },
      { agent: 'later', version: '2.1.310', target: 'platform', check: later },
    ]
    const result = await checkDownloads(checks, 'scratch', 'linux-arm64')
    expect(result.failed).toBe(true)
    expect(result.rows.map((row) => row.result)).toEqual(['FAIL: HTTP 404', 'SKIP: no package for this platform', 'OK: 2.1.310'])
    expect(result.rows[2]).toMatchObject({ agent: 'later', platform: 'linux-arm64', target: 'platform', version: '2.1.310' })
    expect(unsupported).not.toHaveBeenCalled()
    expect(later).toHaveBeenCalledOnce()
  })

  it('does not fail a run containing only unsupported targets', async () => {
    expect((await checkDownloads([{ agent: 'none', version: '1', target: null, check: vi.fn() }], 'scratch', 'freebsd-x64')).failed).toBe(false)
  })

  it('fails the run when a downloaded binary answers with a different version', async () => {
    const result = await checkDownloads([{ agent: 'cli', version: '1.0.98', target: 'package', check: async () => '1.0.99' }], 'scratch', 'win32-x64')
    expect(result.failed).toBe(true)
    expect(result.rows[0]?.result).toContain('expected 1.0.98, received 1.0.99')
  })
})
