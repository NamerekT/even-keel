import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fixEpisodes, isLaunch } from '../chain/launches.js'
import { readSnapshots } from '../chain/snapshots.js'
import { latestVersion, spentOn, writtenTasks } from '../changelog/store.js'
import { closedTasks, loadChainState, loadQuestions, readLaunches } from '../chain/store.js'
import { parseConfig } from '../config.js'
import { root } from '../locations.js'
import { noticeOf } from '../notice/notice.js'
import { readProfiles } from '../profiles/store.js'
import { Mailbox } from '../sessions/mailbox.js'
import { fileOf } from '../settings/file.js'
import { readSettings } from '../settings/store.js'
import { backupDatabase } from './copy.js'
import { DATABASE_VERSION, databaseVersion, openDatabase, SQLITE_FILE, STEPS, Writes, type Queryable } from './database.js'
import { databaseDirOf, dataDirOf } from './owner.js'
import { stateValue } from './service-state.js'
import { IMPORTED_SUFFIX, prepareDatabase } from './state-files.js'

// Frozen samples of the database. Versions 1 and 2 were `node:sqlite` files: they are imported at the first start.
// Version 3 is the first PGlite one, version 4 adds the settings, version 5 the tracker profiles, version 6 the
// changelog drafts, version 7 their turns' spend, version 8 the pull requests, version 9 the colors, version 10 the
// shelved tasks, version 11 the keys shared by projects, version 12 the profiles' rules and the extra task feeds: a later step must migrate each, and each step itself must still make exactly the tables of its sample.
// A schema change is a new step and a new sample next to these, never an edit of either.
const fixture = (version: number) => readFileSync(join(root, 'test', 'fixtures', `database-v${version}`, 'even-keel.sql'), 'utf8')

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'
/** A second project of the key `ABC` (BTN-271). */
const SECOND_ABC = '66666666-6666-4666-8666-666666666666'
/** The extra task feed of `ABC` (BTN-66). */
const FEED = '77777777-7777-4777-8777-777777777777'

describe('frozen samples of the database', { timeout: 120_000 }, () => {
  let stateDir: string
  let logs: string[]
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'even-keel-db-sample-'))
    logs = []
  })
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }))

  const prepare = () => prepareDatabase({ stateDir, log: (line) => logs.push(line) })
  const withSqlite = (sql: string) => {
    const file = new DatabaseSync(join(stateDir, SQLITE_FILE))
    file.exec(sql)
    file.close()
  }

  async function readsWhole(db: Queryable) {
    expect(await databaseVersion(db)).toBe(DATABASE_VERSION)
    const state = await loadChainState(db)
    expect(state.active.map((chain) => [chain.project, chain.current?.task])).toEqual([[ABC, 'ABC-2']])
    expect(state.queue).toEqual([XYZ])
    expect(state.orders).toEqual({ [ABC]: ['ABC-1', 'ABC-2', 'ABC-3'], [XYZ]: ['XYZ-7'] })
    expect(state.skipped).toEqual({ [ABC]: ['ABC-9'] })
    expect(state.leftovers[XYZ]?.[0]?.task).toBe('XYZ-1')
    expect(state.released).toEqual({ [ABC]: ['ABC-1'] })
    expect(state.ci[ABC]?.afterGreen).toBe(state.ci[ABC]?.green)
    expect((await loadQuestions(db)).map((question) => [question.task, question.done === true])).toEqual([['ABC-2', false]])
    const launches = await readLaunches(db)
    expect(launches.filter(isLaunch).map((entry) => entry.task)).toEqual(['ABC-1', 'ABC-2', 'ABC-FIX', 'ABC-FIX'])
    expect(launches[0]?.fallback).toBe('codex')
    expect(fixEpisodes(launches).episodes[ABC]?.map((episode) => [episode.id, episode.end?.how])).toEqual([
      ['ABC-FIX.1', 'landed'],
      ['ABC-FIX.2', 'dropped'],
    ])
    const [snapshot] = await readSnapshots(db)
    expect(snapshot).toMatchObject({ task: 'ABC-2', reason: 'relay', notePath: 'C:\\repos\\example-project\\.temp\\handoff.md' })
    expect(snapshot?.note).toContain('Done: the parser.')
    expect(await closedTasks(db)).toEqual([
      expect.objectContaining({
        project: ABC,
        task: 'ABC-1',
        tracker: 'huly',
        title: 'Parse the example input',
        url: 'https://huly.example.com/workbench/example/browse/ABC-1',
        closedAt: '2026-10-04T12:00:00.000Z',
      }),
    ])
  }

  async function mailboxOf(db: PGlite) {
    const mailbox = await Mailbox.open(db, new Writes(() => {}), () => new Date('2026-10-18T10:10:00.000Z'))
    return {
      waiting: mailbox.waiting().map((mail) => mail.text),
      session: mailbox.of('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee').map((mail) => [mail.fate, mail.event, mail.files]),
    }
  }

  it('of SQLite version 1 is imported whole, once, and the file kept', async () => {
    withSqlite(fixture(1))
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      expect((await mailboxOf(opened.db)).waiting).toEqual([])
    } finally {
      await opened.close()
    }
    expect(existsSync(join(stateDir, SQLITE_FILE))).toBe(false)
    expect(existsSync(join(stateDir, `${SQLITE_FILE}${IMPORTED_SUFFIX}`))).toBe(true)
    expect(logs).toEqual([expect.stringMatching(/moved .*even-keel\.db into/)])
    await (await prepare()).close()
    expect(logs).toHaveLength(1)
  })

  it('of SQLite version 2 is imported with its mailbox', async () => {
    withSqlite(fixture(2))
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      expect(await mailboxOf(opened.db)).toEqual({
        waiting: ['And run the slow tests.'],
        session: [
          ['delivered', 'PostToolUse', []],
          ['returned', null, ['C:\\repos\\example-project\\.temp\\inbox\\case.png']],
          ['waiting', null, []],
        ],
      })
    } finally {
      await opened.close()
    }
  })

  it('refuses a SQLite file a newer Even Keel wrote and writes nothing', async () => {
    withSqlite('PRAGMA user_version = 3')
    const code = await prepare().then(
      () => undefined,
      (error: unknown) => noticeOf(error).code,
    )
    expect(code).toBe('storage.newerDatabase')
    expect(existsSync(databaseDirOf(stateDir))).toBe(false)
    expect(existsSync(join(stateDir, SQLITE_FILE))).toBe(true)
  })

  it('of version 3 has the tables step 3 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 1))
    try {
      await frozen.exec(fixture(3))
      expect(await databaseVersion(frozen)).toBe(3)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

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

  it('of version 4 has the tables step 4 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 2))
    try {
      await frozen.exec(fixture(4))
      expect(await databaseVersion(frozen)).toBe(4)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
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

  it('of version 5 has the tables step 5 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 3))
    try {
      await frozen.exec(fixture(5))
      expect(await databaseVersion(frozen)).toBe(5)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
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

  it('of version 6 has the tables step 6 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 4))
    try {
      await frozen.exec(fixture(6))
      expect(await databaseVersion(frozen)).toBe(6)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
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

  it('of version 7 has the tables step 7 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 5))
    try {
      await frozen.exec(fixture(7))
      expect(await databaseVersion(frozen)).toBe(7)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
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

  it('of version 8 has the schema step 8 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 6))
    try {
      await frozen.exec(fixture(8))
      expect(await databaseVersion(frozen)).toBe(8)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 8 is brought to the current schema and read whole, the pull requests with it', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(8))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      const chain = await loadChainState(opened.db)
      expect(chain.reviews).toEqual({ [ABC]: [expect.objectContaining({ task: 'ABC-3', number: 12, seen: ['review:41'], feedback: 'Rename it.' })] })
      const colors = (await readSettings(opened.db)).rows.filter((row) => row.key === 'color')
      expect(colors).toEqual([
        { key: 'color', project: ABC, qualifier: '', value: 1 },
        { key: 'color', project: XYZ, qualifier: '', value: 2 },
      ])
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it('of version 9 has the schema step 9 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 7))
    try {
      await frozen.exec(fixture(9))
      expect(await databaseVersion(frozen)).toBe(9)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 9 is brought to the current schema and read whole, the colors with it', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(9))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      expect(parseConfig(fileOf(await readSettings(opened.db))).colors).toEqual({ [ABC]: 3, [XYZ]: 2 })
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it('of version 10 has the schema step 10 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 8))
    try {
      await frozen.exec(fixture(10))
      expect(await databaseVersion(frozen)).toBe(10)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 10 is brought to the current schema and read whole, the shelved tasks with it', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(10))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      const chain = await loadChainState(opened.db)
      expect(chain.shelved).toEqual({ [ABC]: [{ task: 'ABC-1', sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', at: '2026-10-19T09:00:00.000Z' }] })
      await opened.db.query(`insert into projects (id, key, repo, branch, position) values ('${SECOND_ABC}', 'ABC', 'C:\\repos\\example-release', 'release/v1', 2)`)
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it('of version 11 has the schema step 11 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 9))
    try {
      await frozen.exec(fixture(11))
      expect(await databaseVersion(frozen)).toBe(11)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 11 is read whole, two projects of one key with it (BTN-271)', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(11))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      expect(parseConfig(fileOf(await readSettings(opened.db))).keys).toEqual({ [ABC]: 'ABC', [XYZ]: 'XYZ', [SECOND_ABC]: 'ABC' })
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it('of version 12 has the schema step 12 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 10))
    try {
      await frozen.exec(fixture(12))
      expect(await databaseVersion(frozen)).toBe(12)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it("of version 12 is read with the profiles' rules and the feed's profile (BTN-66)", async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(12))
    await frozen.close()
    const opened = await prepare()
    try {
      expect(await databaseVersion(opened.db)).toBe(DATABASE_VERSION)
      const profiles = await readProfiles(opened.db)
      expect(profiles.profiles.map((profile) => profile.rules)).toEqual([{ terminal: ['Done', 'Canceled', 'Shipped'] }, undefined, { excludedLabels: ['wontfix'] }])
      expect(profiles.feeds).toEqual({ [FEED]: '55555555-5555-4555-8555-555555555555' })
      const config = parseConfig(fileOf(await readSettings(opened.db)))
      expect(config.feeds).toEqual({ [ABC]: [{ id: FEED, tracker: 'github', key: 'ABCGH', place: 'octo-org/ideas' }] })
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })
})

async function schemaOf(db: Queryable) {
  const columns = await db.query(
    `select table_name, column_name, data_type, is_nullable, column_default, is_identity
       from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`,
  )
  const indexes = await db.query("select indexname, indexdef from pg_indexes where schemaname = 'public' order by indexname")
  const constraints = await db.query(
    `select conrelid::regclass::text as on_table, conname, pg_get_constraintdef(oid) as def
       from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`,
  )
  return { columns: columns.rows, indexes: indexes.rows, constraints: constraints.rows }
}
