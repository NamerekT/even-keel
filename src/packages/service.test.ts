import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { settingsOf } from './model.js'
import { Packages } from './service.js'
import { loadPackages, savePackages } from './store.js'

let dir: string | undefined
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function fixture() {
  dir = mkdtempSync(join(tmpdir(), 'even-keel-package-settings-'))
  const home = dir
  const put = (path: string, value: unknown) => {
    const file = join(home, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value))
  }
  const plugin = (version: string, toolsets: string) => {
    put('own/.claude-plugin/marketplace.json', { name: 'example', plugins: [{ name: 'tools', source: './plugin' }] })
    put('own/plugin/.claude-plugin/plugin.json', { name: 'tools', version })
    put('own/plugin/.mcp.json', { mcpServers: { tools: { command: 'example-server', env: { TOOLSETS: toolsets, MODE: 'fast' } } } })
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
    baseEnv: () => ({}), poolOf: () => ({}), port: 0, log: () => {}, onChange: () => {},
  }
  return { packages: new Packages(deps), file, plugin, reload: () => new Packages(deps) }
}

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
