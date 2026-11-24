import { describe, expect, it } from 'vitest'
import { commandOf, installArgsOf, serviceScriptOf, updateTargetOf } from './cli-args.js'
import { fromNpxCache } from './updates/prefix.js'

describe('commandOf', () => {
  it('runs in the foreground without a command, and names the rest', () => {
    expect(commandOf([])).toEqual({ command: 'run' })
    expect(commandOf(['install'])).toEqual({ command: 'install', machine: null, service: false })
    expect(commandOf(['uninstall'])).toEqual({ command: 'uninstall' })
    expect(commandOf(['update'])).toEqual({ command: 'update', version: null })
    expect(commandOf(['update', '0.2.0'])).toEqual({ command: 'update', version: '0.2.0' })
    expect(commandOf(['--help'])).toEqual({ command: 'help' })
  })

  it('refuses what it does not know', () => {
    expect(commandOf(['instal'])).toEqual({ command: 'help', error: 'unknown command instal' })
    expect(commandOf(['install', 'now'])).toEqual({ command: 'help', error: 'install takes only --machine <string>, --root <folder> and --service' })
    expect(commandOf(['uninstall', 'now'])).toEqual({ command: 'help', error: 'uninstall takes no arguments' })
    expect(commandOf(['update', '0.2.0', 'now'])).toEqual({ command: 'help', error: 'update takes one version at most' })
  })

  it('joins a hub with a connection string and an optional folder of projects, and tells the status', () => {
    expect(commandOf(['join', 'ekm1.abc'])).toEqual({ command: 'join', line: 'ekm1.abc', root: null })
    expect(commandOf(['join', 'ekm1.abc', '--root', '/srv/projects'])).toEqual({ command: 'join', line: 'ekm1.abc', root: '/srv/projects' })
    expect(commandOf(['join', '--root', 'D:\\projects', 'ekm1.abc'])).toEqual({ command: 'join', line: 'ekm1.abc', root: 'D:\\projects' })
    expect(commandOf(['join', 'hub.example.com'])).toEqual({ command: 'join', line: 'hub.example.com', root: null })
    expect(commandOf(['join'])).toEqual({ command: 'help', error: 'join takes one hub address or connection string' })
    expect(commandOf(['join', 'ekm1.abc', '--root'])).toEqual({ command: 'help', error: '--root needs a folder' })
    expect(commandOf(['status'])).toEqual({ command: 'status' })
    expect(commandOf(['status', 'now'])).toEqual({ command: 'help', error: 'status takes no arguments' })
  })

  it('installs a machine of a hub with its string, its folder of projects and, on Windows, as the service', () => {
    expect(commandOf(['install', '--machine', 'ekm1.abc'])).toEqual({ command: 'install', machine: { line: 'ekm1.abc', root: null }, service: false })
    expect(commandOf(['install', '--root', '/srv/projects', '--machine', 'ekm1.abc'])).toEqual({
      command: 'install',
      machine: { line: 'ekm1.abc', root: '/srv/projects' },
      service: false,
    })
    expect(commandOf(['install', '--service'])).toEqual({ command: 'install', machine: null, service: true })
    expect(commandOf(['install', '--machine', 'ekm1.abc', '--service'])).toEqual({ command: 'install', machine: { line: 'ekm1.abc', root: null }, service: true })
  })

  it('refuses a machine install without its string, and a folder of projects without a machine', () => {
    const needs = '--machine needs the hub address for machines or the connection string the hub issued'
    expect(commandOf(['install', '--machine'])).toEqual({ command: 'help', error: needs })
    expect(commandOf(['install', '--machine', '--service'])).toEqual({ command: 'help', error: needs })
    expect(commandOf(['install', '--machine', 'ekm1.abc', '--root'])).toEqual({ command: 'help', error: '--root needs a folder' })
    expect(commandOf(['install', '--root', '/srv/projects'])).toEqual({ command: 'help', error: '--root is the folder of projects of a machine: give --machine <string> too' })
    expect(commandOf(['install', '--machine', 'a', '--machine', 'b'])).toEqual({ command: 'help', error: '--machine is given twice' })
  })
})

describe('installArgsOf', () => {
  it('gives the global copy the same options the npx one got', () => {
    expect(installArgsOf({ machine: null, service: false })).toEqual([])
    expect(installArgsOf({ machine: { line: 'ekm1.abc', root: 'D:\\projects' }, service: true })).toEqual(['--machine', 'ekm1.abc', '--root', 'D:\\projects', '--service'])
    expect(installArgsOf({ machine: { line: 'ekm1.abc', root: null }, service: false })).toEqual(['--machine', 'ekm1.abc'])
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

  it('passes a machine and its folder of projects in each script own way', () => {
    const machine = { line: 'ekm1.abc', root: '/srv/projects' }
    expect(serviceScriptOf('win32', 'C:\\even-keel', 'install', machine)).toEqual([
      'pwsh',
      ['-NoProfile', '-File', 'C:\\even-keel\\service\\install.ps1', '-Machine', 'ekm1.abc', '-Projects', '/srv/projects'],
    ])
    expect(serviceScriptOf('darwin', '/opt/even-keel', 'install', { line: 'ekm1.abc', root: null })).toEqual([
      '/bin/sh',
      ['/opt/even-keel/service/install.sh', '--machine', 'ekm1.abc'],
    ])
  })
})
