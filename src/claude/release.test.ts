import { describe, expect, it } from 'vitest'
import { claudePlatform, daemonVersionOf, manifestEntry } from './release.js'

describe('claudePlatform', () => {
  it('names the build of the manifest for the machine', () => {
    expect(claudePlatform('win32', 'x64', false)).toBe('win32-x64')
    expect(claudePlatform('darwin', 'arm64', false)).toBe('darwin-arm64')
    expect(claudePlatform('linux', 'x64', false)).toBe('linux-x64')
    expect(claudePlatform('linux', 'arm64', true)).toBe('linux-arm64-musl')
  })

  it('has none for a machine Claude Code is not built for', () => {
    expect(claudePlatform('freebsd', 'x64', false)).toBeNull()
    expect(claudePlatform('win32', 'ia32', false)).toBeNull()
  })
})

describe('manifestEntry', () => {
  const manifest = {
    version: '2.1.301',
    platforms: { 'win32-x64': { binary: 'claude.exe', checksum: 'ab'.repeat(32), size: 271840416 } },
  }

  it('takes the binary, its sha256 and size for the platform', () => {
    expect(manifestEntry(manifest, '2.1.301', 'win32-x64')).toEqual({ binary: 'claude.exe', checksum: 'ab'.repeat(32), size: 271840416 })
  })

  it('refuses a manifest of another version, without the platform or with a strange entry', () => {
    expect(() => manifestEntry(manifest, '2.1.302', 'win32-x64')).toThrow(/2.1.301/)
    expect(() => manifestEntry(manifest, '2.1.301', 'linux-x64')).toThrow(/linux-x64/)
    expect(() => manifestEntry({ version: '2.1.301', platforms: { 'win32-x64': { binary: '../claude.exe', checksum: 'x', size: 1 } } }, '2.1.301', 'win32-x64')).toThrow()
    expect(() => manifestEntry(null, '2.1.301', 'win32-x64')).toThrow()
  })
})

describe('daemonVersionOf', () => {
  it('reads the version of `claude daemon status`', () => {
    const status = 'pid:     28500\nversion: 2.1.303\nuptime:  108s\norigin:  transient — started on-demand by `claude --bg`\n'
    expect(daemonVersionOf(status)).toBe('2.1.303')
    expect(daemonVersionOf(status.replace(/\n/g, '\r\n'))).toBe('2.1.303')
  })

  it('has none when no daemon runs', () => {
    expect(daemonVersionOf('daemon: not running\n')).toBeNull()
    expect(daemonVersionOf('')).toBeNull()
  })
})
