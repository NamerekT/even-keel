import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openCodeBinaryIn, openCodePackage } from './release.js'

describe('openCodePackage', () => {
  it('names the npm package of the platform', () => {
    expect(openCodePackage('win32', 'x64', false)).toBe('opencode-windows-x64')
    expect(openCodePackage('win32', 'arm64', false)).toBe('opencode-windows-arm64')
    expect(openCodePackage('linux', 'x64', false)).toBe('opencode-linux-x64')
    expect(openCodePackage('darwin', 'arm64', false)).toBe('opencode-darwin-arm64')
  })

  it('takes the musl build on a Linux without glibc', () => {
    expect(openCodePackage('linux', 'arm64', true)).toBe('opencode-linux-arm64-musl')
    expect(openCodePackage('darwin', 'x64', true)).toBe('opencode-darwin-x64')
  })

  it('has none for a machine OpenCode is not built for', () => {
    expect(openCodePackage('freebsd', 'x64', false)).toBeNull()
    expect(openCodePackage('linux', 'ia32', false)).toBeNull()
  })
})

describe('openCodeBinaryIn', () => {
  it('is the native binary of the unpacked package', () => {
    const folder = join('state', 'cli', 'opencode', '1.18.25')
    expect(openCodeBinaryIn(folder, 'win32')).toBe(join(folder, 'bin', 'opencode.exe'))
    expect(openCodeBinaryIn(folder, 'linux')).toBe(join(folder, 'bin', 'opencode'))
  })
})
