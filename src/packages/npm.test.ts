import { describe, expect, it } from 'vitest'
import { binOf, dependencyChanges, installArgs, latestOf, lockedVersions, parseNpx, pinnedEntry } from './npm.js'

describe('parseNpx', () => {
  it('reads the package, its range and the arguments after it', () => {
    expect(parseNpx({ command: 'npx', args: ['-y', '@firfi/huly-mcp@latest', '--flag'] })).toEqual({ name: '@firfi/huly-mcp', range: 'latest', args: ['--flag'] })
    expect(parseNpx({ command: 'npx.cmd', args: ['--yes', 'server-x'] })).toEqual({ name: 'server-x', range: 'latest', args: [] })
    expect(parseNpx({ command: 'npx', args: ['server-x@^1.2'] })).toEqual({ name: 'server-x', range: '^1.2', args: [] })
  })

  it('leaves alone any other command and an npx it cannot read', () => {
    expect(parseNpx({ command: 'uvx', args: ['server'] })).toBeNull()
    expect(parseNpx({ command: 'npx', args: ['-p', 'a', 'b'] })).toBeNull()
    expect(parseNpx({ type: 'http', url: 'https://example.com/mcp' })).toBeNull()
  })
})

describe('latestOf', () => {
  it('takes the last version npm view lists', () => {
    expect(latestOf('"1.2.3"')).toBe('1.2.3')
    expect(latestOf('["1.2.0","1.2.3"]')).toBe('1.2.3')
    expect(latestOf('')).toBeNull()
  })
})

describe('binOf', () => {
  it('takes the bin named as the package, else the first', () => {
    expect(binOf({ bin: './dist/index.cjs' }, '@firfi/huly-mcp')).toBe('./dist/index.cjs')
    expect(binOf({ bin: { other: 'a.js', 'huly-mcp': 'b.js' } }, '@firfi/huly-mcp')).toBe('b.js')
    expect(binOf({ bin: { first: 'a.js' } }, 'pkg')).toBe('a.js')
    expect(binOf({}, 'pkg')).toBeNull()
  })
})

describe('installArgs', () => {
  it('trusts the npm cache', () => {
    const args = installArgs('C:\\cache\\x', 'x@1.0.0')
    expect(args).toContain('--prefer-offline')
    expect(args.at(-1)).toBe('x@1.0.0')
  })

  it('keeps a lock of the exact tree and runs no install scripts unless the package allows them', () => {
    const args = installArgs('C:\\cache\\x', 'x@1.0.0')
    expect(args).not.toContain('--no-save')
    expect(args).toContain('--save-exact')
    expect(args).toContain('--ignore-scripts')
    expect(installArgs('C:\\cache\\x', 'x@1.0.0', true)).not.toContain('--ignore-scripts')
  })
})

describe('lockedVersions', () => {
  it('reads every installed package of a lock, nested ones by their path', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: { '': { dependencies: { x: '1.0.0' } }, 'node_modules/x': { version: '1.0.0' }, 'node_modules/x/node_modules/ws': { version: '8.0.0' }, 'node_modules/@s/y': { version: '2.1.0' } },
    })
    expect(lockedVersions(lock)).toEqual({ x: '1.0.0', 'x/ws': '8.0.0', '@s/y': '2.1.0' })
    expect(lockedVersions('not json')).toBeNull()
    expect(lockedVersions('{}')).toBeNull()
  })
})

describe('dependencyChanges', () => {
  it('names what changed, came and went, the server package itself left out', () => {
    const before = { x: '1.0.0', ws: '8.0.0', old: '1.0.0', same: '3.0.0' }
    const after = { x: '1.1.0', ws: '8.1.0', fresh: '0.1.0', same: '3.0.0' }
    expect(dependencyChanges(before, after, 'x')).toEqual(['fresh +0.1.0', 'old -1.0.0', 'ws 8.0.0 → 8.1.0'])
    expect(dependencyChanges(before, before, 'x')).toEqual([])
  })
})

describe('pinnedEntry', () => {
  it('runs the installed bin with node and keeps the rest of the entry', () => {
    expect(pinnedEntry({ command: 'npx', args: ['-y', 'x@latest'], env: { A: '1' } }, 'C:\\cache\\x.js', ['--flag'])).toEqual({ command: 'node', args: ['C:\\cache\\x.js', '--flag'], env: { A: '1' } })
  })
})
