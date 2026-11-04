import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { settingsOf, type ServerEntry } from './model.js'
import { installPinned, type NpxSpec } from './npm.js'
import { Packages } from './service.js'
import { loadPackages, savePackages } from './store.js'

vi.mock('./npm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./npm.js')>()
  return {
    ...actual,
    resolveVersion: vi.fn(async (spec: NpxSpec) => spec.range),
    installPinned: vi.fn(async (entry: ServerEntry, spec: NpxSpec, version: string, prefix: string) => {
      const home = join(prefix, 'node_modules', ...spec.name.split('/'))
      mkdirSync(home, { recursive: true })
      writeFileSync(join(home, 'package.json'), JSON.stringify({ name: spec.name, version, bin: 'index.js' }))
      return actual.pinnedServer(entry, spec, version, prefix)
    }),
  }
})

let dir: string | undefined
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
  vi.mocked(installPinned).mockClear()
})

function fixture() {
  dir = mkdtempSync(join(tmpdir(), 'even-keel-package-settings-'))
  const home = dir
  const put = (path: string, value: unknown) => {
    const file = join(home, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value))
  }
  const plugin = (version: string, toolsets: string, server: ServerEntry = { command: 'example-server' }) => {
    put('own/.claude-plugin/marketplace.json', { name: 'example', plugins: [{ name: 'tools', source: './plugin' }] })
    put('own/plugin/.claude-plugin/plugin.json', { name: 'tools', version })
    put('own/plugin/.mcp.json', { mcpServers: { tools: { ...server, env: { TOOLSETS: toolsets, MODE: 'fast' } } } })
  }
  plugin('1.0.0', 'workitems,milestones')
  const file = join(home, 'state/packages.json')
  savePackages(file, {
    packages: { 'tools@example': { kind: 'plugin', plugin: { name: 'tools', marketplace: 'example' }, default: true, settings: {}, installs: [] } },
    projects: {}, pins: {},
  })
  const deps = {
    file, cache: join(home, 'state/packages'), envFile: join(home, '.env'), repos: { project: home },
    globalDir: join(home, 'global'), ownDir: join(home, 'own'), skillsDir: join(home, 'skills'),
    skillRoots: () => [], claudeConfigs: () => [], rules: { aliases: {}, trackers: [] }, tracker: () => undefined,
    agentOf: () => 'claude', updateMarketplace: async () => {}, addMarketplace: async () => {},
    baseEnv: () => ({}), poolOf: () => ({}), port: 0, log: (line: string) => void lines.push(line), onChange: () => {},
  }
  const lines: string[] = []
  return { packages: new Packages(deps), deps, file, cache: deps.cache, plugin, lines, reload: () => new Packages(deps) }
}

describe('pinned servers across plugin updates', () => {
  const npx = (version: string): ServerEntry => ({ command: 'npx', args: ['-y', `example-mcp@${version}`] })
  // Install ids are Date.now() in base 36: two installs within one millisecond would share a folder.
  const tick = () => new Promise((done) => setTimeout(done, 5))

  async function updated(server: ServerEntry, before?: (cache: string, id: string) => void) {
    const { packages, file, cache, plugin } = fixture()
    plugin('1.0.0', 'all', npx('1.0.0'))
    await packages.install('tools@example')
    const old = loadPackages(file)!.packages['tools@example']!.installs[0]!
    before?.(cache, old.id)
    plugin('2.0.0', 'all', server)
    await tick()
    await packages.update('tools@example')
    const installs = loadPackages(file)!.packages['tools@example']!.installs
    return { install: installs.at(-1)!, home: join(cache, 'tools@example', installs.at(-1)!.id, 'servers', 'tools') }
  }

  it('copies a server of the same version from the previous install', async () => {
    const { install, home } = await updated(npx('1.0.0'))
    expect(installPinned).toHaveBeenCalledTimes(1)
    expect(install.version).toBe('2.0.0')
    const bin = join(home, 'node_modules', 'example-mcp', 'index.js')
    expect(install.servers.tools!.entry.args).toEqual([bin])
    expect(existsSync(join(home, 'node_modules', 'example-mcp', 'package.json'))).toBe(true)
  })

  it('installs a new npm version through npm', async () => {
    const { install } = await updated(npx('1.1.0'))
    expect(installPinned).toHaveBeenCalledTimes(2)
    expect(install.servers.tools!.npm).toEqual({ name: 'example-mcp', version: '1.1.0' })
  })

  it('installs through npm when the previous install lost its folder', async () => {
    const { home } = await updated(npx('1.0.0'), (cache, id) => rmSync(join(cache, 'tools@example', id, 'servers'), { recursive: true, force: true }))
    expect(installPinned).toHaveBeenCalledTimes(2)
    expect(vi.mocked(installPinned).mock.calls[1]![3]).toBe(home)
  })
})

describe('package settings across updates', () => {
  it('takes new defaults without storing them and keeps explicit package and project values after restart', async () => {
    const { packages, file, plugin, reload } = fixture()
    await packages.install('tools@example')
    expect(loadPackages(file)!.packages['tools@example']!.settings).toEqual({})
    expect(packages.view().packages[0]!.settings).toEqual({ TOOLSETS: 'workitems,milestones', MODE: 'fast' })
    packages.setSetting('tools@example', 'MODE', 'careful')
    packages.setSetting('tools@example', 'TOOLSETS', 'projects', 'project')
    plugin('2.0.0', 'issues,milestones')
    await packages.update('tools@example')
    const view = reload().view()
    expect(view.packages[0]!.settings).toEqual({ TOOLSETS: 'issues,milestones', MODE: 'careful' })
    expect(view.projects.project!.cells['tools@example']!.settings).toEqual({ TOOLSETS: 'projects', MODE: 'careful' })
  })

  it('removes inherited values on save and resets both levels to their inherited defaults', async () => {
    const { packages, file, plugin } = fixture()
    await packages.install('tools@example')
    packages.setSetting('tools@example', 'MODE', 'fast')
    packages.setSetting('tools@example', 'TOOLSETS', 'workitems,milestones', 'project')
    expect(loadPackages(file)!.packages['tools@example']!.settings).toEqual({})
    expect(loadPackages(file)!.projects.project!.settings).toEqual({})
    packages.setSetting('tools@example', 'MODE', 'careful')
    packages.setSetting('tools@example', 'TOOLSETS', 'projects', 'project')
    packages.setSetting('tools@example', 'MODE', null)
    packages.setSetting('tools@example', 'TOOLSETS', null, 'project')
    plugin('2.0.0', 'issues,milestones')
    await packages.update('tools@example')
    expect(packages.view().projects.project!.cells['tools@example']!.settings).toEqual({ TOOLSETS: 'issues,milestones', MODE: 'fast' })
  })

  it('leaves pinned installs on their own defaults', async () => {
    const { packages, file, plugin, reload } = fixture()
    await packages.install('tools@example')
    const stored = loadPackages(file)!
    const old = stored.packages['tools@example']!.installs[0]!
    stored.pins.project = { 'ABC-1': { 'tools@example': old.id } }
    savePackages(file, stored)
    const next = reload()
    plugin('2.0.0', 'issues,milestones')
    await next.update('tools@example')
    const updated = loadPackages(file)!
    expect(settingsOf(updated, 'project', 'tools@example')).toEqual({ TOOLSETS: 'issues,milestones', MODE: 'fast' })
    const target = next['target']({ project: 'project', name: 'tools@example', install: old.id, server: 'tools' })
    expect(target!.entry.env).toEqual({ TOOLSETS: 'workitems,milestones', MODE: 'fast' })
  })

  it('keeps a package override when that setting gets a new default', async () => {
    const { packages, file, plugin, reload } = fixture()
    await packages.install('tools@example')
    packages.setSetting('tools@example', 'TOOLSETS', 'custom')
    plugin('2.0.0', 'issues,milestones')
    await packages.update('tools@example')
    expect(reload().view().packages[0]!.settings.TOOLSETS).toBe('custom')
    expect(loadPackages(file)!.packages['tools@example']!.settings).toEqual({ TOOLSETS: 'custom' })
  })

  it('preserves each server default when a plugin has several servers with the same setting name', async () => {
    const { packages, file, reload } = fixture()
    await packages.install('tools@example')
    const stored = loadPackages(file)!
    const install = stored.packages['tools@example']!.installs[0]!
    install.servers.second = { entry: { command: 'other-server', env: { TOOLSETS: 'different' } }, npm: null }
    savePackages(file, stored)
    const next = reload()
    expect(next['target']({ project: 'project', name: 'tools@example', install: install.id, server: 'tools' })!.entry.env).toEqual({ TOOLSETS: 'workitems,milestones', MODE: 'fast' })
  })
})

describe('a task pins versions, not the set (BTN-706)', () => {
  const install = (id: string, servers: string[]) => ({
    id, version: '1.0.0', at: '2026-11-02T07:00:00.000Z', extras: true,
    servers: Object.fromEntries(servers.map((name) => [name, { entry: { command: 'node' }, npm: null }])),
  })

  function pinned() {
    const { file, cache, reload } = fixture()
    savePackages(file, {
      packages: {
        'tools@example': { kind: 'plugin', plugin: { name: 'tools', marketplace: 'example' }, default: true, settings: {}, installs: [install('old', ['tools']), install('new', ['tools'])] },
        'extra@example': { kind: 'plugin', plugin: { name: 'extra', marketplace: 'example' }, default: false, settings: {}, installs: [install('e1', ['extra'])] },
      },
      projects: {},
      pins: { project: { 'ABC-1': { 'tools@example': 'old' } } },
    })
    mkdirSync(join(cache, 'tools@example', 'old'), { recursive: true })
    return { packages: reload(), file, cache }
  }
  const enabled = [{ enabledPlugins: { 'tools@example': true, 'extra@example': true } }]

  it('gives a later package to the task on its current install and adds it to the pin, the pinned one staying old', () => {
    const { packages, file } = pinned()
    packages.choose('project', 'extra@example', 'on')
    const start = packages.startOf('project', 'ABC-1', 'claude')
    expect(start.plugins.map((each) => [each.package, each.marketplace])).toEqual([['tools@example', 'ek-old'], ['extra@example', 'ek-e1']])
    expect(loadPackages(file)!.pins.project).toEqual({ 'ABC-1': { 'tools@example': 'old', 'extra@example': 'e1' } })
    expect(packages.otherPlugins('project', 'ABC-1', enabled)).toEqual({})
  })

  it('drops a package the project turned off from the pin, and its old install with it', () => {
    const { packages, file, cache } = pinned()
    packages.choose('project', 'tools@example', 'off')
    packages.choose('project', 'extra@example', 'on')
    expect(packages.startOf('project', 'ABC-1', 'claude').plugins.map((each) => each.package)).toEqual(['extra@example'])
    const stored = loadPackages(file)!
    expect(stored.pins.project).toEqual({ 'ABC-1': { 'extra@example': 'e1' } })
    expect(stored.packages['tools@example']!.installs.map((each) => each.id)).toEqual(['new'])
    expect(existsSync(join(cache, 'tools@example', 'old'))).toBe(false)
    expect(packages.otherPlugins('project', 'ABC-1', enabled)).toEqual({ 'tools@example': false })
  })
})

describe('packages only the user can make ready', () => {
  it('names an enabled package until it is installed', async () => {
    const { packages } = fixture()
    expect(packages.unready('project')).toEqual(['tools@example'])
    await packages.install('tools@example')
    expect(packages.unready('project')).toEqual([])
  })
})

describe('adding the manual Claude marketplace', () => {
  it('explains a missing Claude executable without exposing spawn ENOENT', async () => {
    const { deps } = fixture()
    deps.addMarketplace = async () => { throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) }
    await expect(new Packages(deps).addMarketplace()).rejects.toMatchObject({ notice: { code: 'packages.marketplaceCliMissing' } })
  })

  it('keeps other command errors and allows a retry after failure', async () => {
    const { deps } = fixture()
    deps.addMarketplace = vi.fn().mockRejectedValueOnce(new Error('permission denied')).mockResolvedValueOnce(undefined)
    const packages = new Packages(deps)
    await expect(packages.addMarketplace()).rejects.toMatchObject({ notice: { code: 'packages.marketplaceAdd', detail: 'permission denied' } })
    await expect(packages.addMarketplace()).resolves.toBeUndefined()
  })
})
