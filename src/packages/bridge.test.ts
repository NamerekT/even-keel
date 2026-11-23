import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { seedPackages } from './plugins.js'
import { Packages, type PackagesDeps } from './service.js'
import { emptyPackages, type PackageRecord, type PackagesFile } from './model.js'
import { loadPackages, savePackages } from './store.js'

const OLD = 'checkpoint@example'
const BRIDGE = 'agent-bridge@example'
const record = (name: string, id?: string): PackageRecord => ({
  kind: 'plugin', plugin: { name, marketplace: 'example' }, default: true, settings: {},
  installs: id === undefined ? [] : [{ id, version: '1.0.0', at: '2026-11-11T00:00:00.000Z', servers: {}, extras: true }],
})

let dir: string | undefined
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})

function fixture(saved: PackagesFile) {
  mkdirSync('.temp', { recursive: true })
  dir = mkdtempSync(join('.temp', 'bridge-'))
  const ownDir = join(dir, 'own')
  mkdirSync(join(ownDir, '.claude-plugin'), { recursive: true })
  writeFileSync(join(ownDir, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'example', plugins: [{ name: 'agent-bridge', source: './bridge' }] }))
  const file = join(dir, 'packages.json')
  savePackages(file, saved)
  const lines: string[] = []
  const deps: PackagesDeps = {
    file, cache: join(dir, 'cache'), envFile: join(dir, '.env'), repos: { project: dir }, ownDir,
    globalDir: join(dir, 'global'), skillsDir: join(dir, 'skills'), skillRoots: () => [], claudeConfigs: () => [],
    rules: { aliases: {}, trackers: [] }, tracker: () => undefined, agentOf: () => 'claude',
    updateMarketplace: async () => {}, addMarketplace: async () => {}, baseEnv: () => ({}), poolOf: () => ({}),
    port: 0, log: (line) => { lines.push(line) }, onChange: () => {},
  }
  // Every saved install has its files: one without them is lost and starts no session (BTN-1542).
  for (const [name, each] of Object.entries(saved.packages)) for (const { id } of each.installs) mkdirSync(join(deps.cache, name, id, 'plugin'), { recursive: true })
  const oldDir = join(deps.cache, OLD, 'old', 'plugin')
  mkdirSync(oldDir, { recursive: true })
  return { packages: new Packages(deps), file, oldDir, lines, reload: () => new Packages(deps) }
}

describe('the built-in bridge transition', () => {
  it('retires the old package and its project choices, adds the bridge and logs the replacement once', () => {
    const saved = emptyPackages()
    saved.packages[OLD] = record('checkpoint', 'old')
    saved.projects.project = { on: [OLD], off: [OLD, BRIDGE], settings: {} }
    const { file, lines, reload } = fixture(saved)
    const migrated = loadPackages(file)!
    expect(migrated.packages[OLD]?.removed).toBe(true)
    expect(migrated.packages[BRIDGE]).toMatchObject({ default: true, plugin: { name: 'agent-bridge', marketplace: 'example' } })
    expect(migrated.projects.project).toBeUndefined()
    expect(lines.filter((line) => line.includes('replaced'))).toEqual([`packages: ${OLD} replaced by ${BRIDGE}`])
    const before = readFileSync(file, 'utf8')
    lines.length = 0
    reload()
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(lines).toEqual([])
  })

  it.each([false, true])('keeps only the old pinned plugin through launches and restarts, already removed: %s', (removed) => {
    const saved = emptyPackages()
    saved.packages[OLD] = { ...record('checkpoint', 'old'), removed }
    saved.packages[BRIDGE] = record('agent-bridge', 'new')
    saved.pins.project = { 'ABC-1': { [OLD]: 'old', [BRIDGE]: 'new' } }
    const { packages, file, oldDir, reload } = fixture(saved)
    expect(packages.startOf('project', 'ABC-1', 'claude').plugins.map((each) => each.package)).toEqual([OLD])
    expect(loadPackages(file)!.pins.project?.['ABC-1']).toEqual({ [OLD]: 'old' })
    expect(existsSync(oldDir)).toBe(true)
    expect(packages.otherPlugins('project', 'ABC-1', [{ enabledPlugins: { [OLD]: true, [BRIDGE]: true } }])).toEqual({ [BRIDGE]: false })
    expect(reload().startOf('project', 'ABC-1', 'codex').plugins.map((each) => each.package)).toEqual([OLD])
    expect(packages.startOf('project', 'ABC-2', 'claude').plugins.map((each) => each.package)).toEqual([BRIDGE])
    packages.release('project', 'ABC-1')
    expect(existsSync(oldDir)).toBe(false)
    expect(loadPackages(file)!.packages[OLD]).toBeUndefined()
  })

  it('leaves a retired record and a foreign marketplace alone', () => {
    const saved = emptyPackages()
    saved.packages[OLD] = { ...record('checkpoint', 'old'), removed: true }
    saved.packages['checkpoint@foreign'] = { ...record('checkpoint', 'foreign'), plugin: { name: 'checkpoint', marketplace: 'foreign' } }
    saved.packages[BRIDGE] = record('agent-bridge', 'new')
    const { file, lines } = fixture(saved)
    expect(loadPackages(file)!).toEqual(saved)
    expect(lines).toEqual([])
  })

  it('uses the bridge when the old pin has no remaining install', () => {
    const saved = emptyPackages()
    saved.packages[OLD] = record('checkpoint')
    saved.packages[BRIDGE] = record('agent-bridge', 'new')
    saved.pins.project = { 'ABC-1': { [OLD]: 'gone' } }
    const { packages } = fixture(saved)
    expect(packages.startOf('project', 'ABC-1', 'claude').plugins.map((each) => each.package)).toEqual([BRIDGE])
  })

  it('knows which sessions bring the mail hooks: the bridge, not the old pinned plugin', () => {
    const saved = emptyPackages()
    saved.packages[OLD] = record('checkpoint', 'old')
    saved.packages[BRIDGE] = record('agent-bridge', 'new')
    saved.pins.project = { 'ABC-1': { [OLD]: 'old' } }
    const { packages } = fixture(saved)
    expect(packages.bringsMail(packages.startOf('project', 'ABC-1', 'claude').plugins)).toBe(false)
    expect(packages.bringsMail(packages.startOf('project', 'ABC-2', 'claude').plugins)).toBe(true)
    expect(packages.bringsMail(undefined)).toBe(false)
  })

  // BTN-1506: after a restart the service knows from the pins which of its running sessions have the mail hooks.
  it('tells from the pins which started tasks brought the mail hooks, a new service too', () => {
    const saved = emptyPackages()
    saved.packages[OLD] = record('checkpoint', 'old')
    saved.packages[BRIDGE] = record('agent-bridge', 'new')
    saved.pins.project = { 'ABC-1': { [OLD]: 'old' } }
    const { packages, reload } = fixture(saved)
    packages.startOf('project', 'ABC-2', 'claude')
    const restarted = reload()
    expect(restarted.pinsMail('project', 'ABC-2')).toBe(true)
    expect(restarted.pinsMail('project', 'ABC-1')).toBe(false)
    expect(restarted.pinsMail('project', 'ABC-3')).toBe(false)
    expect(restarted.chatsMail()).toBe(true)
    restarted.release('project', 'ABC-2')
    expect(restarted.pinsMail('project', 'ABC-2')).toBe(false)
  })

  it('prunes an empty retired record when its stale pin is released', () => {
    const saved = emptyPackages()
    saved.packages[OLD] = record('checkpoint')
    saved.pins.project = { 'ABC-1': { [OLD]: 'gone' } }
    const { packages, file } = fixture(saved)
    packages.release('project', 'ABC-1')
    expect(loadPackages(file)!.packages[OLD]).toBeUndefined()
  })

  it.each([true, false])('seeds only the bridge from legacy settings, global: %s', (global) => {
    const saved = seedPackages({
      globalSettings: global ? { enabledPlugins: { [OLD]: true } } : undefined,
      projects: [{ key: 'project', settings: [{ enabledPlugins: { [OLD]: true } }] }],
      userServers: {}, builtIn: BRIDGE,
    })
    expect(Object.keys(saved.packages)).toEqual([BRIDGE])
    expect(saved.projects).toEqual({})
  })
})
