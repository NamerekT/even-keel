import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copilotBinaryIn, copilotPackage } from './release.js'

describe('copilotPackage', () => {
  it('names the npm package of the platform', () => {
    expect(copilotPackage('win32', 'x64', false)).toBe('@github/copilot-win32-x64')
    expect(copilotPackage('win32', 'arm64', false)).toBe('@github/copilot-win32-arm64')
    expect(copilotPackage('linux', 'x64', false)).toBe('@github/copilot-linux-x64')
    expect(copilotPackage('darwin', 'arm64', false)).toBe('@github/copilot-darwin-arm64')
  })

  it('takes the musl build on a Linux without glibc', () => {
    expect(copilotPackage('linux', 'x64', true)).toBe('@github/copilot-linuxmusl-x64')
    expect(copilotPackage('darwin', 'x64', true)).toBe('@github/copilot-darwin-x64')
  })

  it('has none for a machine Copilot is not built for', () => {
    expect(copilotPackage('freebsd', 'x64', false)).toBeNull()
    expect(copilotPackage('linux', 'ia32', false)).toBeNull()
  })
})

describe('copilotBinaryIn', () => {
  it('is the native binary of the unpacked package', () => {
    const folder = join('state', 'cli', 'copilot', '1.0.98')
    expect(copilotBinaryIn(folder, 'win32')).toBe(join(folder, 'copilot.exe'))
    expect(copilotBinaryIn(folder, 'darwin')).toBe(join(folder, 'copilot'))
  })
})
