import { describe, expect, it } from 'vitest'
import { binOf, installArgs, latestOf, parseNpx, pinnedEntry } from './npm.js'

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
  it('trusts the npm cache and copies the stubs a trim points to', () => {
    const args = installArgs('C:\\cache\\x', 'x@1.0.0')
    expect(args).toContain('--prefer-offline')
    expect(args).toContain('--install-links')
    expect(args.at(-1)).toBe('x@1.0.0')
  })
})

describe('pinnedEntry', () => {
  it('runs the installed bin with node and keeps the rest of the entry', () => {
    expect(pinnedEntry({ command: 'npx', args: ['-y', 'x@latest'], env: { A: '1' } }, 'C:\\cache\\x.js', ['--flag'])).toEqual({ command: 'node', args: ['C:\\cache\\x.js', '--flag'], env: { A: '1' } })
  })
})
