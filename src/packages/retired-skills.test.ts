import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Packages, type PackagesDeps } from './service.js'
import { emptyPackages, OWN_SKILLS_PACKAGE, type PackageRecord, type PackagesFile } from './model.js'
import { loadPackages, savePackages } from './store.js'

const OTHER = 'example@example'
const record = (name: string, marketplace: string, id: string): PackageRecord => ({
  kind: 'plugin', plugin: { name, marketplace }, default: false, settings: {},
  installs: [{ id, version: '1.0.0', at: '2026-11-11T00:00:00.000Z', servers: {}, extras: false }],
})

let dir: string | undefined
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})

function fixture(saved: PackagesFile) {
  mkdirSync('.temp', { recursive: true })
  dir = mkdtempSync(join('.temp', 'retired-skills-'))
  const file = join(dir, 'packages.json')
  savePackages(file, saved)
  const lines: string[] = []
  const deps: PackagesDeps = {
    file, cache: join(dir, 'cache'), envFile: join(dir, '.env'), repos: { project: dir }, ownDir: join(dir, 'own'),
    globalDir: join(dir, 'global'), skillsDir: join(dir, 'skills'), claudeConfigs: () => [],
    rules: { aliases: {}, trackers: [] }, tracker: () => undefined, agentOf: () => 'codex',
    updateMarketplace: async () => {}, addMarketplace: async () => {}, baseEnv: () => ({}), poolOf: () => ({}),
    port: 0, log: (line) => { lines.push(line) }, onChange: () => {},
  }
  for (const [name, each] of Object.entries(saved.packages)) for (const { id } of each.installs) mkdirSync(join(deps.cache, name, id, 'plugin'), { recursive: true })
  mkdirSync(join(deps.skillsDir, 'plugin', 'skills', 'example'), { recursive: true })
  writeFileSync(join(deps.skillsDir, 'plugin', 'skills', 'example', 'SKILL.md'), '# Example\n')
  return { deps, file, lines, reload: () => new Packages(deps) }
}

describe('the retired package of the user\'s own skills (BTN-1691)', () => {
  it('goes at start from the catalog, every project\'s set and the pins, with its files and state/skills', () => {
    const saved = emptyPackages()
    saved.packages[OWN_SKILLS_PACKAGE] = record('my-skills', 'even-keel-skills', 'mine')
    saved.packages[OTHER] = record('example', 'example', 'kept')
    saved.projects.project = { on: [OWN_SKILLS_PACKAGE, OTHER], off: [], settings: {} }
    saved.projects.other = { on: [], off: [OWN_SKILLS_PACKAGE], settings: {} }
    saved.pins.project = { 'TSK-1': { [OWN_SKILLS_PACKAGE]: 'mine', [OTHER]: 'kept' }, 'TSK-2': { [OWN_SKILLS_PACKAGE]: 'mine' } }
    const { deps, file, lines, reload } = fixture(saved)
    const packages = reload()
    const after = loadPackages(file)!
    expect(Object.keys(after.packages)).toEqual([OTHER])
    expect(after.projects).toEqual({ project: { on: [OTHER], off: [], settings: {} } })
    expect(after.pins).toEqual({ project: { 'TSK-1': { [OTHER]: 'kept' } } })
    expect(existsSync(join(deps.cache, OWN_SKILLS_PACKAGE))).toBe(false)
    expect(existsSync(join(deps.cache, OTHER, 'kept'))).toBe(true)
    expect(existsSync(deps.skillsDir)).toBe(false)
    expect(lines.filter((line) => line.includes(OWN_SKILLS_PACKAGE))).toHaveLength(1)
    expect(packages.view().packages.map((each) => each.name)).toEqual([OTHER])
    expect(packages.startOf('project', 'TSK-1', 'codex').plugins?.map((each) => each.package)).toEqual([OTHER])

    const before = readFileSync(file, 'utf8')
    lines.length = 0
    reload()
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(lines).toEqual([])
  })
})
