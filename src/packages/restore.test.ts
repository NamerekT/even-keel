import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerEntry } from './model.js'
import { installPinned, type NpxSpec } from './npm.js'
import { Packages } from './service.js'
import { cleanFixture, fixture } from './service.fixture.js'
import { loadPackages } from './store.js'
import { routeOf } from './launch.js'

vi.mock('./npm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./npm.js')>()
  return {
    ...actual,
    resolveVersion: vi.fn(async (spec: NpxSpec) => spec.range),
    installPinned: vi.fn(async (entry: ServerEntry, spec: NpxSpec, version: string, prefix: string) => {
      const home = join(prefix, 'node_modules', ...spec.name.split('/'))
      mkdirSync(home, { recursive: true })
      writeFileSync(join(home, 'package.json'), JSON.stringify({ name: spec.name, version, bin: 'index.js' }))
      writeFileSync(join(prefix, 'package-lock.json'), JSON.stringify({ packages: { '': {}, [`node_modules/${spec.name}`]: { version } } }))
      return actual.pinnedServer(entry, spec, version, prefix)
    }),
  }
})

afterEach(() => {
  cleanFixture()
  vi.mocked(installPinned).mockClear()
})

describe('installs whose folders are gone: a state folder restored on another host', () => {
  const npx = (version: string): ServerEntry => ({ command: 'npx', args: ['-y', `example-mcp@${version}`] })
  const settled = async (packages: Packages) => {
    for (let waited = 0; packages.installingOf('project').length > 0; waited += 10) {
      if (waited > 10_000) throw new Error('still installing')
      await new Promise((done) => setTimeout(done, 10))
    }
  }

  it('installs each anew at the start under its id and versions, and leaves one with its folder alone', async () => {
    const { packages, deps, file, cache, plugin, lines, reload } = fixture()
    plugin('1.0.0', 'all', npx('1.0.0'))
    await packages.install('tools@example')
    const before = loadPackages(file)!.packages['tools@example']!.installs[0]!
    rmSync(cache, { recursive: true, force: true })
    vi.mocked(installPinned).mockClear()
    // The hub's own machine: the hub's gateway runs the server from this very install, so it is installed all the same.
    const moved = new Packages({ ...deps, hub: false, hubServers: () => [routeOf('project', 'tools@example', before.id, 'tools')] })
    await moved.start()
    await settled(moved)
    const home = join(cache, 'tools@example', before.id, 'servers', 'tools')
    expect(vi.mocked(installPinned)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(installPinned).mock.calls[0]!.slice(2, 4)).toEqual(['1.0.0', home])
    const after = loadPackages(file)!.packages['tools@example']!.installs
    expect(after.map((each) => each.id)).toEqual([before.id])
    expect(after[0]!.servers.tools!.entry.args).toEqual([join(home, 'node_modules', 'example-mcp', 'index.js')])
    expect(existsSync(join(cache, 'tools@example', before.id, 'plugin', '.claude-plugin', 'plugin.json'))).toBe(true)
    expect(lines).toContain(`packages: tools@example ${before.id} lost its folder: installing it again`)
    await moved.close()

    vi.mocked(installPinned).mockClear()
    const again = reload()
    await again.start()
    await settled(again)
    expect(vi.mocked(installPinned)).not.toHaveBeenCalled()
    await again.close()
  })

  it('leaves one for Update when this host lacks its plugin at that version', async () => {
    const { packages, file, cache, deps, plugin, lines, reload } = fixture()
    plugin('1.0.0', 'all', npx('1.0.0'))
    await packages.install('tools@example')
    const id = loadPackages(file)!.packages['tools@example']!.installs[0]!.id
    rmSync(cache, { recursive: true, force: true })
    rmSync(deps.ownDir, { recursive: true, force: true })
    vi.mocked(installPinned).mockClear()
    const moved = reload()
    await moved.start()
    await settled(moved)
    expect(vi.mocked(installPinned)).not.toHaveBeenCalled()
    expect(lines.some((line) => line.startsWith(`packages: tools@example ${id} lost its folder, and its marketplace has`))).toBe(true)
    await moved.close()
  })

  it('moves a task pinned to a lost install of another version onto the current one (BTN-1542)', async () => {
    const { packages, file, cache, plugin, lines, reload } = fixture()
    await packages.install('tools@example')
    const old = loadPackages(file)!.packages['tools@example']!.installs[0]!.id
    packages.startOf('project', 'ABC-1', 'codex')
    expect(loadPackages(file)!.pins.project).toEqual({ 'ABC-1': { 'tools@example': old } })
    rmSync(cache, { recursive: true, force: true })
    plugin('2.0.0', 'all')
    const moved = reload()
    await moved.start()
    await settled(moved)
    const now = loadPackages(file)!.packages['tools@example']!.installs.at(-1)!
    expect(now.version).toBe('2.0.0')
    const start = moved.startOf('project', 'ABC-1', 'codex')
    expect(start.plugins.map((each) => each.marketplace)).toEqual([`ek-${now.id}`])
    expect(existsSync(join(start.plugins[0]!.dir, '.claude-plugin', 'plugin.json'))).toBe(true)
    expect(loadPackages(file)!.pins.project).toEqual({ 'ABC-1': { 'tools@example': now.id } })
    expect(lines).toContain(`packages: ABC-1 was pinned to tools@example ${old}, whose files are gone: moved to ${now.id}`)
    await moved.close()
  })

  it('holds the chain on a current install whose files are gone, names the marketplace this host lacks and starts no session without it', async () => {
    const { packages, file, cache, deps, reload } = fixture()
    await packages.install('tools@example')
    packages.startOf('project', 'ABC-1', 'claude')
    rmSync(cache, { recursive: true, force: true })
    rmSync(deps.ownDir, { recursive: true, force: true })
    const moved = reload()
    await moved.start()
    await settled(moved)
    expect(moved.view().projects.project!.cells['tools@example']!.problems).toEqual([{ kind: 'lost', marketplace: 'example' }])
    expect(moved.unready('project')).toEqual(['tools@example'])
    expect(moved.view().packages.find((each) => each.name === 'tools@example')!.installed).toBe(false)
    expect(() => moved.startOf('project', 'ABC-1', 'claude')).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'packages.lostMarketplace' }) }))
    expect(existsSync(join(cache, 'tools@example'))).toBe(false)
    await moved.close()
    expect(loadPackages(file)!.pins.project?.['ABC-1']).toBeDefined()
  })

  it('installs a lost one anew at the same version once the marketplace is back, and the chain goes on', async () => {
    const { packages, file, cache, deps, plugin, reload } = fixture()
    await packages.install('tools@example')
    const old = loadPackages(file)!.packages['tools@example']!.installs[0]!.id
    packages.startOf('project', 'ABC-1', 'claude')
    rmSync(cache, { recursive: true, force: true })
    rmSync(deps.ownDir, { recursive: true, force: true })
    const moved = reload()
    await moved.start()
    await settled(moved)
    plugin('1.0.0', 'workitems,milestones')
    expect(moved.view().projects.project!.cells['tools@example']!.problems).toEqual([{ kind: 'lost' }])
    await moved.install('tools@example')
    const now = loadPackages(file)!.packages['tools@example']!.installs.at(-1)!
    expect(now.id).not.toBe(old)
    expect(moved.unready('project')).toEqual([])
    expect(moved.startOf('project', 'ABC-1', 'claude').plugins.map((each) => each.marketplace)).toEqual([`ek-${now.id}`])
    await moved.close()
  })
})
