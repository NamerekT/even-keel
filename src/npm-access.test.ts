import { describe, expect, it } from 'vitest'
import { globalBinOf, isAccessError, nearestExisting, npmPrefixAdvice, rcFileOf, rootRefusal } from './npm-access.js'

describe('nearestExisting', () => {
  it('is the folder itself when it is there', () => {
    expect(nearestExisting('/usr/local/lib/node_modules', () => true)).toBe('/usr/local/lib/node_modules')
  })

  it('climbs to the nearest parent that is there', () => {
    const there = new Set(['/usr/local', '/usr', '/'])
    expect(nearestExisting('/usr/local/lib/node_modules', (path) => there.has(path))).toBe('/usr/local')
  })

  it('stops at the root', () => {
    expect(nearestExisting('/a/b', () => false)).toBe('/')
  })
})

describe('globalBinOf', () => {
  it('is the bin next to lib of the prefix', () => {
    expect(globalBinOf('/usr/local/lib/node_modules')).toBe('/usr/local/bin')
  })

  it('is none for a folder not under lib', () => {
    expect(globalBinOf('/opt/node_modules')).toBeNull()
  })
})

describe('rcFileOf', () => {
  it('takes the startup file of the shell', () => {
    expect(rcFileOf('/bin/zsh')).toBe('~/.zshrc')
    expect(rcFileOf('/usr/local/bin/bash')).toBe('~/.bashrc')
  })

  it('takes zsh, the default of macOS, for an unknown or missing shell', () => {
    expect(rcFileOf(undefined)).toBe('~/.zshrc')
    expect(rcFileOf('/bin/sh')).toBe('~/.zshrc')
  })
})

describe('npmPrefixAdvice', () => {
  const advice = npmPrefixAdvice('/usr/local/lib/node_modules', '/bin/bash', 'npx even-keel@0.3.0')

  it('names the folder and gives the commands for the shell', () => {
    expect(advice).toContain('/usr/local/lib/node_modules')
    expect(advice).toContain('mkdir -p ~/.npm-global')
    expect(advice).toContain('npm config set prefix ~/.npm-global')
    expect(advice).toContain(`echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc`)
    expect(advice).toContain('source ~/.bashrc')
    expect(advice).toContain('npx even-keel@0.3.0')
  })

  it('warns off sudo', () => {
    expect(advice).toMatch(/not .*sudo/i)
  })
})

describe('rootRefusal', () => {
  it('is for root on macOS and Linux only', () => {
    expect(rootRefusal('darwin', 0, 'npx even-keel')).toMatch(/root/)
    expect(rootRefusal('linux', 0, 'npx even-keel')).toMatch(/root/)
    expect(rootRefusal('darwin', 501, 'npx even-keel')).toBeNull()
    expect(rootRefusal('win32', undefined, 'npx even-keel')).toBeNull()
  })
})

describe('isAccessError', () => {
  it('sees the EACCES of npm', () => {
    expect(isAccessError('npm error code EACCES\nnpm error syscall mkdir')).toBe(true)
    expect(isAccessError('npm error code E404')).toBe(false)
  })
})
