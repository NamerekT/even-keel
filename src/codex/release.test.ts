import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexBinaryIn, codexTarget } from './release.js'

describe('codexTarget', () => {
  it('names the npm package of the platform and the folder of its binary', () => {
    expect(codexTarget('win32', 'x64')).toEqual({ suffix: 'win32-x64', triple: 'x86_64-pc-windows-msvc' })
    expect(codexTarget('win32', 'arm64')).toEqual({ suffix: 'win32-arm64', triple: 'aarch64-pc-windows-msvc' })
    expect(codexTarget('linux', 'x64')).toEqual({ suffix: 'linux-x64', triple: 'x86_64-unknown-linux-musl' })
    expect(codexTarget('darwin', 'arm64')).toEqual({ suffix: 'darwin-arm64', triple: 'aarch64-apple-darwin' })
  })

  it('has none for a machine Codex is not built for', () => {
    expect(codexTarget('freebsd', 'x64')).toBeNull()
    expect(codexTarget('linux', 'ia32')).toBeNull()
  })
})

describe('codexBinaryIn', () => {
  it('is the native binary of the unpacked package', () => {
    const folder = join('state', 'cli', 'codex', '0.162.1')
    expect(codexBinaryIn(folder, { suffix: 'win32-x64', triple: 'x86_64-pc-windows-msvc' }, 'win32')).toBe(join(folder, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'))
    expect(codexBinaryIn(folder, { suffix: 'linux-x64', triple: 'x86_64-unknown-linux-musl' }, 'linux')).toBe(join(folder, 'vendor', 'x86_64-unknown-linux-musl', 'bin', 'codex'))
  })
})
