import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { availablePlugins, hasExtras, locatePlugin, pluginServers, seedPackages } from './plugins.js'

let dir: string | undefined
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function write(file: string, value: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
}

/** A global folder with the marketplace `local` in a directory and `remote` from GitHub with one plugin in the CLI's cache. */
function registry(): { globalDir: string; local: string; cached: string } {
  dir = mkdtempSync(join(tmpdir(), 'even-keel-plugins-'))
  const globalDir = join(dir, 'claude')
  const local = join(dir, 'local')
  const remote = join(globalDir, 'plugins', 'marketplaces', 'remote')
  const cached = join(globalDir, 'plugins', 'cache', 'remote', 'far', '1.2.0')
  write(join(globalDir, 'plugins', 'known_marketplaces.json'), {
    local: { source: { source: 'directory', path: local }, installLocation: local },
    remote: { source: { source: 'github', repo: 'octo-org/remote' }, installLocation: remote },
  })
  write(join(local, '.claude-plugin', 'marketplace.json'), { name: 'local', plugins: [{ name: 'tracker', source: './plugins/tracker' }] })
  write(join(remote, '.claude-plugin', 'marketplace.json'), {
    name: 'remote',
    plugins: [
      { name: 'near', source: './near' },
      { name: 'far', source: { source: 'github', repo: 'octo-org/far' } },
      { name: 'gone', source: { source: 'url', url: 'https://example.com/gone.git' } },
    ],
  })
  write(join(globalDir, 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'far@remote': [{ scope: 'user', installPath: cached, version: '1.2.0' }] } })
  write(join(cached, '.claude-plugin', 'plugin.json'), { name: 'far', version: '1.2.0' })
  return { globalDir, local, cached }
}

describe('locatePlugin', () => {
  it('finds a plugin by its path inside the marketplace folder', () => {
    const { globalDir, local } = registry()
    expect(locatePlugin(globalDir, 'tracker', 'local')).toEqual({ dir: join(local, 'plugins', 'tracker'), kind: 'directory' })
  })

  it('takes a plugin from elsewhere from the CLI cache', () => {
    const { globalDir, cached } = registry()
    expect(locatePlugin(globalDir, 'far', 'remote')).toEqual({ dir: cached, kind: 'github' })
  })

  it('refuses a plugin the CLI has not installed, an unknown plugin and an unknown marketplace', () => {
    const { globalDir } = registry()
    expect(() => locatePlugin(globalDir, 'gone', 'remote')).toThrow(/install it in Claude Code first/)
    expect(() => locatePlugin(globalDir, 'nothing', 'local')).toThrow(/has no plugin nothing/)
    expect(() => locatePlugin(globalDir, 'tracker', 'elsewhere')).toThrow(/knows no marketplace elsewhere/)
  })

  it('lists the plugins of every known marketplace', () => {
    const { globalDir } = registry()
    expect(availablePlugins(globalDir)).toEqual([
      { plugin: 'tracker', marketplace: 'local' },
      { plugin: 'near', marketplace: 'remote' },
      { plugin: 'far', marketplace: 'remote' },
      { plugin: 'gone', marketplace: 'remote' },
    ])
  })
})

describe('pluginServers', () => {
  it('reads .mcp.json and the manifest, and tells whether the plugin brings more than servers', () => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-plugins-'))
    write(join(dir, '.mcp.json'), { mcpServers: { huly: { command: 'npx', args: ['-y', 'huly'] } } })
    write(join(dir, '.claude-plugin', 'plugin.json'), { name: 'huly', mcpServers: { extra: { type: 'http', url: 'https://example.com/mcp' } } })
    expect(Object.keys(pluginServers(dir))).toEqual(['huly', 'extra'])
    expect(hasExtras(dir)).toBe(false)
    mkdirSync(join(dir, 'skills'))
    expect(hasExtras(dir)).toBe(true)
  })
})

describe('seedPackages', () => {
  it('builds the catalog from what sessions get today', () => {
    const file = seedPackages({
      globalSettings: { enabledPlugins: { 'checkpoint@even-keel': true, 'playwright@official': true, 'old@official': false } },
      projects: [
        { key: 'ABC', settings: [{ enabledPlugins: { 'huly@even-keel': true } }, { enabledPlugins: { 'playwright@official': false } }] },
        { key: 'XYZ', settings: [] },
      ],
      userServers: { strata: { command: 'strata', env: { MODE: 'fast' } } },
    })
    expect(file.packages).toEqual({
      'checkpoint@even-keel': { kind: 'plugin', plugin: { name: 'checkpoint', marketplace: 'even-keel' }, default: true, settings: {}, installs: [] },
      'playwright@official': { kind: 'plugin', plugin: { name: 'playwright', marketplace: 'official' }, default: true, settings: {}, installs: [] },
      'huly@even-keel': { kind: 'plugin', plugin: { name: 'huly', marketplace: 'even-keel' }, default: false, settings: {}, installs: [] },
      strata: { kind: 'mcp', server: { command: 'strata', env: { MODE: 'fast' } }, default: true, settings: { MODE: 'fast' }, installs: [] },
    })
    expect(file.projects).toEqual({ ABC: { on: ['huly@even-keel'], off: ['playwright@official'], settings: {} } })
  })
})
