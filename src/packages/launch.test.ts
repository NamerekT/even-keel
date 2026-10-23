import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyPackages, type PackageInstall, type PackageRecord } from './model.js'
import { installMarketplace, otherPlugins, parseRoute, routeOf, sessionPackages, sessionReach } from './launch.js'

const install = (id: string, servers: string[], extras = true): PackageInstall => ({
  id,
  version: '1.0.0',
  at: '2026-10-17T10:00:00.000Z',
  servers: Object.fromEntries(servers.map((name) => [name, { entry: { command: 'node' }, npm: null }])),
  extras,
})

function catalog() {
  const file = emptyPackages()
  const huly: PackageRecord = { kind: 'plugin', plugin: { name: 'huly', marketplace: 'even-keel' }, default: false, settings: {}, installs: [install('a', ['huly']), install('b', ['huly'])] }
  file.packages['huly@even-keel'] = huly
  file.packages.strata = { kind: 'mcp', server: { command: 'strata' }, default: true, settings: {}, installs: [install('s1', ['strata'], false)] }
  file.packages['pending@even-keel'] = { kind: 'plugin', plugin: { name: 'pending', marketplace: 'even-keel' }, default: true, settings: {}, installs: [] }
  file.projects.ABC = { on: ['huly@even-keel'], off: [], settings: {} }
  return file
}

const places = { gateway: 'http://127.0.0.1:4748', cache: join('C:', 'state', 'packages'), projectId: '11111111-1111-4111-8111-111111111111' }

describe('routes', () => {
  it('name the project by its id, the package with its install and the server', () => {
    const route = routeOf(places.projectId, 'huly@even-keel', 'b', 'huly')
    expect(route).toBe('/mcp/11111111-1111-4111-8111-111111111111/huly%40even-keel@b/huly')
    expect(parseRoute(route)).toEqual({ project: places.projectId, name: 'huly@even-keel', install: 'b', server: 'huly' })
    expect(parseRoute('/mcp/x/strata@s1/strata')).toEqual({ project: 'x', name: 'strata', install: 's1', server: 'strata' })
  })

  it('refuses any other path', () => {
    expect(parseRoute('/mcp/x/strata/strata')).toBeNull()
    expect(parseRoute('/api/state')).toBeNull()
    expect(parseRoute('/mcp/x/strata@s1/strata/more')).toBeNull()
  })
})

describe('sessionPackages', () => {
  it('gives the current install of every package of the project, plugin servers under the plugin', () => {
    const got = sessionPackages(catalog(), 'ABC', 'ABC-1', places)
    expect(got.installs).toEqual({ 'huly@even-keel': 'b', strata: 's1' })
    expect(got.plugins).toEqual([
      {
        dir: join(places.cache, 'huly@even-keel', 'b', 'plugin'),
        name: 'huly',
        marketplace: 'ek-b',
        marketplaceFile: join(places.cache, 'huly@even-keel', 'b', '.claude-plugin', 'marketplace.json'),
        servers: ['huly'],
      },
    ])
    expect(got.mcp).toEqual([
      { name: 'huly', plugin: 'huly', url: `http://127.0.0.1:4748${routeOf(places.projectId, 'huly@even-keel', 'b', 'huly')}` },
      { name: 'strata', plugin: null, url: `http://127.0.0.1:4748${routeOf(places.projectId, 'strata', 's1', 'strata')}` },
    ])
  })

  it('keeps a task on the installs it is pinned to', () => {
    const file = catalog()
    file.pins.ABC = { 'ABC-1': { 'huly@even-keel': 'a' } }
    const got = sessionPackages(file, 'ABC', 'ABC-1', places)
    expect(got.installs).toEqual({ 'huly@even-keel': 'a' })
    expect(got.mcp.map((each) => each.url)).toEqual([`http://127.0.0.1:4748${routeOf(places.projectId, 'huly@even-keel', 'a', 'huly')}`])
  })

  it('skips a pin whose install is gone', () => {
    const file = catalog()
    file.pins.ABC = { 'ABC-1': { 'huly@even-keel': 'zzz' } }
    expect(sessionPackages(file, 'ABC', 'ABC-1', places).mcp).toEqual([])
  })
})

describe('sessionReach', () => {
  it('names the plugins and the gateway servers of the packages the project has on', () => {
    expect(sessionReach(catalog(), 'ABC')).toEqual({ plugins: ['huly@even-keel', 'pending@even-keel'], servers: ['plugin_huly_huly', 'strata'] })
  })

  it('leaves out a package the project turned off', () => {
    const file = catalog()
    file.projects.XYZ = { on: [], off: ['strata'], settings: {} }
    expect(sessionReach(file, 'XYZ')).toEqual({ plugins: ['pending@even-keel'], servers: [] })
  })
})

describe('installMarketplace', () => {
  it('is a marketplace of the install alone, its plugin in the folder beside it', () => {
    expect(installMarketplace('huly', 'b')).toEqual({ name: 'ek-b', owner: { name: 'Even Keel' }, plugins: [{ name: 'huly', source: './plugin' }] })
  })
})

describe('otherPlugins', () => {
  it('turns off every enabled plugin the set does not bring', () => {
    const enabled = [{ enabledPlugins: { 'huly@even-keel': true, 'playwright@official': true, 'old@official': false } }, { enabledPlugins: { 'local@x': true } }]
    expect(otherPlugins(enabled, ['huly@even-keel'])).toEqual({ 'playwright@official': false, 'local@x': false })
  })
})
