import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fixEpisodes, isLaunch } from '../chain/launches.js'
import { readSnapshots } from '../chain/snapshots.js'
import { closedTasks, loadChainState, loadQuestions, readLaunches } from '../chain/store.js'
import { root } from '../locations.js'
import { noticeOf } from '../notice/notice.js'
import { Mailbox } from '../sessions/mailbox.js'
import { DATABASE_VERSION, databaseVersion, openDatabase, SQLITE_FILE, STEPS, Writes, type Queryable } from './database.js'
import { databaseDirOf, dataDirOf } from './owner.js'
import { IMPORTED_SUFFIX, prepareDatabase } from './state-files.js'

// Frozen samples of the database. Versions 1 and 2 were `node:sqlite` files: they are imported at the first start.
// Version 3 is the first PGlite one: a later step must migrate it, and step 3 itself must still make exactly its tables.
// A schema change is a new step and a new sample next to these, never an edit of either.
const fixture = (version: number) => readFileSync(join(root, 'test', 'fixtures', `database-v${version}`, 'even-keel.sql'), 'utf8')

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'

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
    const state = await loadChainState(db, { ABC, XYZ })
    expect(state.active.map((chain) => [chain.project, chain.current?.task])).toEqual([['ABC', 'ABC-2']])
    expect(state.queue).toEqual(['XYZ'])
    expect(state.orders).toEqual({ ABC: ['ABC-1', 'ABC-2', 'ABC-3'], XYZ: ['XYZ-7'] })
    expect(state.skipped).toEqual({ ABC: ['ABC-9'] })
    expect(state.leftovers.XYZ?.[0]?.task).toBe('XYZ-1')
    expect(state.released).toEqual({ ABC: ['ABC-1'] })
    expect(state.ci.ABC?.afterGreen).toBe(state.ci.ABC?.green)
    expect((await loadQuestions(db)).map((question) => [question.task, question.done === true])).toEqual([['ABC-2', false]])
    const launches = await readLaunches(db, { ABC, XYZ })
    expect(launches.filter(isLaunch).map((entry) => entry.task)).toEqual(['ABC-1', 'ABC-2', 'ABC-FIX', 'ABC-FIX'])
    expect(launches[0]?.fallback).toBe('codex')
    expect(fixEpisodes(launches).episodes.ABC?.map((episode) => [episode.id, episode.end?.how])).toEqual([
      ['ABC-FIX.1', 'landed'],
      ['ABC-FIX.2', 'dropped'],
    ])
    const [snapshot] = await readSnapshots(db)
    expect(snapshot).toMatchObject({ task: 'ABC-2', reason: 'relay', notePath: 'C:\\repos\\example-project\\.temp\\handoff.md' })
    expect(snapshot?.note).toContain('Done: the parser.')
    expect(await closedTasks(db, { ABC, XYZ })).toEqual([
      { project: 'ABC', task: 'ABC-1', tracker: 'huly', title: 'Parse the example input', url: 'https://huly.example.com/workbench/example/browse/ABC-1', closedAt: '2026-10-04T12:00:00.000Z' },
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
