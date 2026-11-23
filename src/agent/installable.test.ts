import { describe, expect, it } from 'vitest'
import { installableClis, npmGlobalFolder } from './installable.js'

const PROVIDERS = ['claude', 'codex']

describe('installableClis', () => {
  it('takes no CLI as installable in a container', () => {
    expect(installableClis(PROVIDERS, { container: true, writable: () => true, env: {}, execPath: '/usr/local/bin/node', platform: 'linux' })).toEqual([])
  })

  it('leaves Claude Code installable when the global npm folder is not writable: its installer writes into the home folder', () => {
    const seen: string[] = []
    const writable = (path: string) => { seen.push(path); return false }
    expect(installableClis(PROVIDERS, { container: false, writable, env: {}, execPath: '/usr/local/bin/node', platform: 'linux' })).toEqual(['claude'])
    expect(seen).toEqual(['/usr/local/lib/node_modules'])
  })

  it('takes every CLI as installable where npm can write its global folder', () => {
    expect(installableClis(PROVIDERS, { container: false, writable: () => true, env: {}, execPath: 'C:\\Program Files\\nodejs\\node.exe', platform: 'win32' })).toEqual(PROVIDERS)
  })
})

describe('npmGlobalFolder', () => {
  it('follows the prefix npm is given, else the one beside node', () => {
    expect(npmGlobalFolder({ npm_config_prefix: '/home/node/.local' }, '/usr/local/bin/node', 'linux')).toBe('/home/node/.local/lib/node_modules')
    expect(npmGlobalFolder({}, '/usr/local/bin/node', 'linux')).toBe('/usr/local/lib/node_modules')
    expect(npmGlobalFolder({}, 'C:\\Program Files\\nodejs\\node.exe', 'win32')).toBe('C:\\Program Files\\nodejs\\node_modules')
  })
})
