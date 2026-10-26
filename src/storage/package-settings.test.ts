import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { upgradeStorage } from './migrations.js'

let dir: string | undefined
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

describe('v13 to v14 package settings', () => {
  it('drops defaults of the current install, keeps custom values and pins, and migrates only once', () => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-settings-migration-'))
    const file = join(dir, 'packages.json')
    const install = (value: string) => ({ id: value, servers: { tools: { entry: { command: 'example', env: { TOOLSETS: value, MODE: 'fast' } }, npm: null } } })
    const before = JSON.stringify({
      version: 13,
      packages: {
        plugin: { kind: 'plugin', settings: { TOOLSETS: 'current', MODE: 'careful' }, installs: [install('old'), install('current')] },
        pending: { kind: 'mcp', server: { type: 'http', headers: { 'X-Toolsets': 'issues', Authorization: 'Bearer ${TOKEN}' } }, settings: { 'X-Toolsets': 'issues', EXTRA: 'keep' }, installs: [] },
      },
      projects: { project: { on: [], off: [], settings: { plugin: { TOOLSETS: 'projects', MODE: 'careful' }, pending: { 'X-Toolsets': 'issues' } } } },
      pins: { project: { 'ABC-1': { plugin: 'old' } } },
    })
    writeFileSync(file, before)
    const upgrade = () => upgradeStorage({ stateDir: dir!, configFile: join(dir!, 'absent.json'), log: () => {} })
    upgrade()
    const migrated = JSON.parse(readFileSync(file, 'utf8'))
    expect(migrated.version).toBe(14)
    expect(migrated.packages.plugin.settings).toEqual({ MODE: 'careful' })
    expect(migrated.packages.pending.settings).toEqual({ EXTRA: 'keep' })
    expect(migrated.projects.project.settings).toEqual({ plugin: { TOOLSETS: 'projects' } })
    expect(migrated.pins).toEqual({ project: { 'ABC-1': { plugin: 'old' } } })
    expect(readFileSync(`${file}.v13.bak`, 'utf8')).toBe(before)
    const once = readFileSync(file, 'utf8')
    upgrade()
    expect(readFileSync(file, 'utf8')).toBe(once)
  })
})
