import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { latestVersion, spentOn, writtenTasks } from '../changelog/store.js'
import { parseConfig } from '../config.js'
import { readProfiles } from '../profiles/store.js'
import { fileOf } from '../settings/file.js'
import { readSettings } from '../settings/store.js'
import { backupDatabase } from './copy.js'
import { ABC, XYZ, fixture, mailboxOf, readsWhole } from './database.fixture.js'
import { databaseDirOf, dataDirOf } from './owner.js'
import { stateValue } from './service-state.js'
import { prepareDatabase } from './state-files.js'

describe('early database samples migrate with settings and profiles', { timeout: 120_000 }, () => {
  let stateDir: string
  let logs: string[]
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'even-keel-db-sample-'))
    logs = []
  })
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }))

  const prepare = () => prepareDatabase({ stateDir, log: (line) => logs.push(line) })

  it('of version 3 is brought to the current schema and read whole', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(3))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      expect((await mailboxOf(opened.db)).waiting).toEqual(['And run the slow tests.'])
      expect((await readSettings(opened.db)).rows.map(({ key, value }) => [key, value])).toEqual([
        ['trimTools', true],
        ['unattended', false],
      ])
      expect(await opened.db.query("select 1 from information_schema.tables where table_name = 'chain_flags'")).toMatchObject({ rows: [] })
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it('of version 4 is brought to the current schema and read whole, the settings with it', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(4))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      const config = parseConfig(fileOf(await readSettings(opened.db)))
      expect(config).toMatchObject({ parallel: 2, unattended: true, trimTools: true, projects: { [ABC]: 'C:\\repos\\example-project', [XYZ]: 'C:\\repos\\other-project' } })
      expect(config.keys).toEqual({ [ABC]: 'ABC', [XYZ]: 'XYZ' })
      expect(config.trackers).toEqual({ [ABC]: 'huly', [XYZ]: 'github' })
      expect(config.settings[ABC]?.models).toEqual({ claude: 'sonnet' })
      expect(config.settings[XYZ]?.branch).toBe('trunk')
      expect(await stateValue(opened.db, 'updates.dismissed')).toBe('0.2.0')
      const copyDir = join(stateDir, 'copy')
      await backupDatabase(opened.db, copyDir)
      const copy = await PGlite.create({ dataDir: dataDirOf(copyDir) })
      try {
        expect(await readSettings(copy)).toEqual(await readSettings(opened.db))
        expect(await stateValue(copy, 'updates.dismissed')).toBe('0.2.0')
      } finally {
        await copy.close()
      }
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it('of version 5 is brought to the current schema and read whole, the profiles with it', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(5))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      const profiles = await readProfiles(opened.db)
      expect(profiles.profiles.map((profile) => [profile.kind, profile.name, profile.isDefault])).toEqual([
        ['huly', 'Huly · example', true],
        ['github', 'GitHub · john-doe', true],
        ['github', 'GitHub · octo-org', false],
      ])
      expect(profiles.profiles[0]?.values.HULY_WORKSPACE).toBe('example')
      expect(profiles.profiles[1]?.expiresAt).toBe('2026-11-18T00:00:00.000Z')
      expect(profiles.links).toEqual({ [ABC]: '33333333-3333-4333-8333-333333333333', [XYZ]: '55555555-5555-4555-8555-555555555555' })
      expect(await stateValue(opened.db, 'profiles.imported')).toBe('2026-10-18T09:00:00.000Z')
      const copyDir = join(stateDir, 'copy')
      await backupDatabase(opened.db, copyDir)
      const copy = await PGlite.create({ dataDir: dataDirOf(copyDir) })
      try {
        expect(await readProfiles(copy)).toEqual(profiles)
        expect(await readSettings(copy)).toEqual(await readSettings(opened.db))
      } finally {
        await copy.close()
      }
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it('of version 6 is brought to the current schema and read whole, the changelog drafts with it', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(6))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      expect(await latestVersion(opened.db, ABC, 'v0.1')).toMatchObject({ number: 2, kind: 'edit', instruction: 'Say how it runs', written: null, spend: null })
      expect(await writtenTasks(opened.db)).toEqual({ [ABC]: { 'v0.1': ['ABC-1', 'ABC-2'] } })
      expect((await spentOn(opened.db, ABC, 'v0.1')).turns).toBe(0)
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it("of version 7 is brought to the current schema and read whole, the changelog turns' spend with it", async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(7))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      expect((await latestVersion(opened.db, ABC, 'v0.1'))?.spend).toMatchObject({ account: 'codex', cost: null })
      expect(await spentOn(opened.db, ABC, 'v0.1')).toEqual({
        turns: 2,
        cost: 0.12,
        unpriced: 1,
        tokens: { input: 2_100, output: 1_100, cacheRead: 34_000, cacheWrite: 6_000 },
      })
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })
})
