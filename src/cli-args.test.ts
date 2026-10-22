import { describe, expect, it } from 'vitest'
import { commandOf, serviceScriptOf } from './cli-args.js'
import { fromNpxCache } from './updates/prefix.js'

describe('commandOf', () => {
  it('runs in the foreground without a command, and names the rest', () => {
    expect(commandOf([])).toEqual({ command: 'run' })
    expect(commandOf(['install'])).toEqual({ command: 'install' })
    expect(commandOf(['uninstall'])).toEqual({ command: 'uninstall' })
    expect(commandOf(['update'])).toEqual({ command: 'update', version: 'latest' })
    expect(commandOf(['update', '0.2.0'])).toEqual({ command: 'update', version: '0.2.0' })
    expect(commandOf(['--help'])).toEqual({ command: 'help' })
  })

  it('refuses what it does not know', () => {
    expect(commandOf(['instal'])).toEqual({ command: 'help', error: 'unknown command instal' })
    expect(commandOf(['install', 'now'])).toEqual({ command: 'help', error: 'install takes no arguments' })
    expect(commandOf(['update', '0.2.0', 'now'])).toEqual({ command: 'help', error: 'update takes one version at most' })
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
