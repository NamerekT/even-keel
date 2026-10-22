import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from './config-store.js'
import { fileOf } from './settings/file.js'
import { importConfig } from './settings/import.js'
import { mirrorDefinitions, putSettings, readSettings } from './settings/store.js'
import { Writes } from './storage/database.js'
import { memoryDatabase } from './storage/memory.js'
import { SCHEMA_VERSION } from './storage/schema.js'

const abc = (fields: Record<string, unknown> = {}) => ({ id: 'id-abc', key: 'ABC', repo: 'C:\\abc', ...fields })
const xyz = (fields: Record<string, unknown> = {}) => ({ id: 'id-xyz', key: 'XYZ', repo: 'C:\\xyz', ...fields })

describe('ConfigStore', { timeout: 30_000 }, () => {
  let db: PGlite
  let writes: Writes
  let warnings: string[]
  let changes: number

  beforeEach(async () => {
    db = await memoryDatabase()
    await mirrorDefinitions(db)
    warnings = []
    writes = new Writes((line) => warnings.push(line))
    changes = 0
  })

  const seed = (raw: Record<string, unknown>) => importConfig(db, raw)
  const open = () => ConfigStore.open({ db, writes, intervalMs: 1000, onChange: () => changes++, warn: (message) => warnings.push(message) })
  /** The stored settings once every write is done, in the config file's shape. */
  const read = async () => {
    await writes.settled()
    return fileOf(await readSettings(db))
  }
  const stored = (raw: Record<string, unknown>) => ({ version: SCHEMA_VERSION, ...raw })

  it('applies settings written past it at the next look, and keeps the last working ones while the stored ones do not parse', async () => {
    await seed({ projects: [abc()] })
    const config = await open()

    await putSettings(db, [{ key: 'parallel', project: null, qualifier: '', value: 0 }], 'hand')
    await config.look()
    expect(config.error?.code).toBe('config.parallel')
    expect(config.current.parallel).toBe(1)
    expect(warnings).toHaveLength(1)

    await seed({ chain: { requiredLabels: ['Auto'] }, projects: [abc(), xyz()] })
    await config.look()
    expect(config.error).toBeNull()
    expect(config.current.rules['id-abc']?.requiredLabels).toEqual(['Auto'])
    expect(config.current.projects).toEqual({ 'id-abc': 'C:\\abc', 'id-xyz': 'C:\\xyz' })
    expect(changes).toBe(2)

    await config.look()
    expect(changes).toBe(2)
  })

  it('does not take its own write back for a look that began before it', async () => {
    await seed({ projects: [abc()] })
    const config = await open()

    const look = config.look()
    config.saveShared({ ...config.view().shared, parallel: 3 }, config.view().shared)
    await look
    await config.look()
    expect(config.current.parallel).toBe(3)
    expect(changes).toBe(1)
  })

  it('writes the settings of a project into its rows and applies them at once', async () => {
    await seed({ projects: [abc(), xyz({ slot: 2 })] })
    const config = await open()
    const form = (project: string) => config.view().projects[project]!

    const settings = { ...form('id-abc'), branch: 'master', prompt: ' Mind Library. ', beforeStart: ['npm ci', ' '], check: ['npm test'], remoteProfiles: { github: 'org' } }
    config.saveProject('id-abc', { ...settings, own: { 'ci.kinds': ['github'], 'ci.waitMinutes': 20, fillMilestone: true } }, form('id-abc'))
    config.saveProject('id-xyz', { ...form('id-xyz'), prompt: 'Run tests.' }, form('id-xyz'))
    expect(await read()).toEqual(
      stored({
        projects: [
          abc({ branch: 'master', prompt: 'Mind Library.', commands: { beforeStart: ['npm ci'], check: ['npm test'] }, ci: { kinds: ['github'], waitMinutes: 20 }, remoteProfiles: { github: 'org' }, fillMilestone: true }),
          xyz({ slot: 2, prompt: 'Run tests.' }),
        ],
      }),
    )
    expect(config.current.settings['id-abc']).toEqual({
      branch: 'master',
      prompt: 'Mind Library.',
      beforeStart: ['npm ci'],
      check: ['npm test'],
      afterGreen: [],
      ci: { guard: true, kinds: ['github'], waitMinutes: 20, recheckMain: true, fixTask: false },
      remoteProfiles: { github: 'org' },
      mergeInto: null,
      pullRequests: false,
      intakeLabel: null,
      fillMilestone: true,
      changelog: 'CHANGELOG.md',
      provider: null,
      models: {},
      accounts: {},
      modelLabels: null,
      promptLanguage: 'en',
      cacheTtl: null,
      checkpointTokens: null,
      checkpointShares: { first: 72, late: 85, hard: 95 },
      own: { 'ci.kinds': ['github'], 'ci.waitMinutes': 20, fillMilestone: true },
    })
  })

  it('removes the rows of cleared settings', async () => {
    await seed({ projects: [abc({ brief: false, prompt: 'Old.', commands: { beforeStart: ['npm ci'], check: ['npm test'] }, ci: { waitMinutes: 5 } })] })
    const config = await open()

    const form = config.view().projects['id-abc']!
    config.saveProject('id-abc', { ...form, prompt: '', beforeStart: [], check: [], own: {} }, form)
    expect(await read()).toEqual(stored({ projects: [abc({ brief: false })] }))
  })

  it('refuses a project it does not know, and settings that would not parse, writing nothing', async () => {
    await seed({ projects: [abc()] })
    const config = await open()
    const form = config.view().projects['id-abc']!

    expect(() => config.saveProject('XYZ', { ...form, prompt: 'Hi.' }, form)).toThrow(/XYZ/)
    expect(() => config.saveProject('id-abc', { ...form, tracker: 'github' }, form)).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'config.trackerProject' }) }))
    expect(await read()).toEqual(stored({ projects: [abc()] }))
    expect(changes).toBe(0)
  })

  it('starts empty from an empty database', async () => {
    const config = await open()
    expect(config.current.projects).toEqual({})
    expect(await read()).toEqual(stored({ projects: [] }))
  })

  it('adds a project the wizard checked, with an id of its own, and applies it at once', async () => {
    await seed({ projects: [abc()] })
    const config = await open()

    const id = config.addProject({ repo: 'D:\\new', branch: 'main', key: 'NEW', name: '', tracker: 'huly', trackerProject: '', profile: null, slot: 1, milestones: [] })
    expect(await read()).toEqual(stored({ projects: [abc(), { id, key: 'NEW', repo: 'D:\\new', slot: 1, color: 2 }] }))
    expect(config.current.keys[id]).toBe('NEW')
    expect(config.current.slots[id]).toBe(1)
  })

  it('refuses a project the config would not parse and writes nothing', async () => {
    await seed({ projects: [abc()] })
    const config = await open()

    // The key may repeat (BTN-271), but two chains on one Huly project need their milestones split.
    expect(() => config.addProject({ repo: 'D:\\new', branch: 'main', key: 'ABC', name: '', tracker: 'huly', trackerProject: '', profile: null, slot: 0, milestones: [] })).toThrow(
      expect.objectContaining({ notice: expect.objectContaining({ code: 'config.trackerProjectShared' }) }),
    )
    expect(await read()).toEqual(stored({ projects: [abc()] }))
  })

  it('removes a project with its rows and applies it at once', async () => {
    await seed({ projects: [abc({ prompt: 'Old.' }), xyz()] })
    const config = await open()

    config.removeProject('id-abc')
    expect(await read()).toEqual(stored({ projects: [xyz()] }))
    expect((await db.query('select * from setting_values where project_id is not null')).rows).toEqual([])
    expect(config.current.projects).toEqual({ 'id-xyz': 'C:\\xyz' })
    expect(() => config.removeProject('id-abc')).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'config.unknownProject' }) }))
  })

  it('writes the shared settings and applies them at once, the tracker too', async () => {
    await seed({ projects: [abc()] })
    const config = await open()

    config.saveShared({ ...config.view().shared, parallel: 2, tracker: 'linear' }, config.view().shared)
    expect(await read()).toEqual(stored({ parallel: 2, tracker: 'linear', projects: [abc()] }))
    expect(config.current.parallel).toBe(2)
    expect(config.view()).toMatchObject({ shared: { tracker: 'linear' }, projects: { 'id-abc': { tracker: 'linear' } } })
  })

  it('writes the chain switches only when they change', async () => {
    const config = await open()
    expect([config.current.unattended, config.current.trimTools]).toEqual([false, true])

    config.saveChainSwitches({ unattended: true, trimTools: true })
    expect(await read()).toEqual(stored({ unattended: true, projects: [] }))
    expect(changes).toBe(1)
    config.saveChainSwitches({ unattended: true })
    expect(changes).toBe(1)
    config.saveChainSwitches({ trimTools: false, unattended: false })
    expect(await read()).toEqual(stored({ trimTools: false, projects: [] }))
  })
})
