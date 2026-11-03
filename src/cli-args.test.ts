import { describe, expect, it } from 'vitest'
import { commandOf, serviceScriptOf, updateTargetOf } from './cli-args.js'
import { fromNpxCache } from './updates/prefix.js'

describe('commandOf', () => {
  it('runs in the foreground without a command, and names the rest', () => {
    expect(commandOf([])).toEqual({ command: 'run' })
    expect(commandOf(['install'])).toEqual({ command: 'install' })
    expect(commandOf(['uninstall'])).toEqual({ command: 'uninstall' })
    expect(commandOf(['update'])).toEqual({ command: 'update', version: null })
    expect(commandOf(['update', '0.2.0'])).toEqual({ command: 'update', version: '0.2.0' })
    expect(commandOf(['--help'])).toEqual({ command: 'help' })
  })

  it('refuses what it does not know', () => {
    expect(commandOf(['instal'])).toEqual({ command: 'help', error: 'unknown command instal' })
    expect(commandOf(['install', 'now'])).toEqual({ command: 'help', error: 'install takes no arguments' })
    expect(commandOf(['update', '0.2.0', 'now'])).toEqual({ command: 'help', error: 'update takes one version at most' })
  })
})

describe('updateTargetOf', () => {
  it('takes next over an older latest for a release candidate', () => {
    expect(updateTargetOf('0.2.0-rc.1', { latest: '0.0.2', next: '0.2.0-rc.2' })).toBe('0.2.0-rc.2')
    expect(updateTargetOf('0.3.0-rc.1', { latest: '0.2.4', next: '0.3.0-rc.2' })).toBe('0.3.0-rc.2')
  })

  it('takes latest for a release candidate once the release is out', () => {
    expect(updateTargetOf('0.2.0-rc.2', { latest: '0.2.0', next: '0.2.0-rc.2' })).toBe('0.2.0')
    expect(updateTargetOf('0.2.0-rc.2', { latest: '0.2.0' })).toBe('0.2.0')
  })

  it('takes only latest for a release', () => {
    expect(updateTargetOf('0.2.0', { latest: '0.2.1', next: '0.3.0-rc.1' })).toBe('0.2.1')
  })

  it('finds nothing when no tag is newer than the installed version', () => {
    expect(updateTargetOf('0.2.0-rc.1', { latest: '0.0.2', next: '0.2.0-rc.1' })).toBeNull()
    expect(updateTargetOf('0.3.0-rc.1', { latest: '0.2.4', next: '0.3.0-rc.1' })).toBeNull()
    expect(updateTargetOf('0.2.1', { latest: '0.2.1', next: '0.3.0-rc.1' })).toBeNull()
    expect(updateTargetOf('0.2.1', { latest: 'garbage' })).toBeNull()
  })
})

describe('fromNpxCache', () => {
  it('tells the npx cache from a global install', () => {
    expect(fromNpxCache('C:\\Users\\john\\AppData\\Local\\npm-cache\\_npx\\1a2b\\node_modules\\even-keel')).toBe(true)
    expect(fromNpxCache('/home/john/.npm/_npx/1a2b/node_modules/even-keel')).toBe(true)
    expect(fromNpxCache('/usr/local/lib/node_modules/even-keel')).toBe(false)
  })
})

describe('serviceScriptOf', () => {
  it('runs the PowerShell script on Windows and the shell one elsewhere', () => {
    expect(serviceScriptOf('win32', 'C:\\npm\\node_modules\\even-keel', 'install')).toEqual(['pwsh', ['-NoProfile', '-File', 'C:\\npm\\node_modules\\even-keel\\service\\install.ps1']])
    expect(serviceScriptOf('linux', '/usr/lib/node_modules/even-keel', 'uninstall')).toEqual(['/bin/sh', ['/usr/lib/node_modules/even-keel/service/uninstall.sh']])
  })
})
