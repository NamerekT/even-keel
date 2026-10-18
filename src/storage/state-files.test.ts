import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyChainState } from '../chain/dispatcher.js'
import { readSnapshots, saveSnapshot } from '../chain/snapshots.js'
import { appendLaunch, closedTasks, loadChainState, loadQuestions, readLaunches, saveChainState, saveClosedTask, saveQuestions } from '../chain/store.js'
import { noticeOf } from '../notice/notice.js'
import { backupDatabase } from './copy.js'
import { checkVersion, DATABASE_VERSION, databaseVersion, STEPS } from './database.js'
import { memoryDatabase } from './memory.js'
import { databaseDirOf, dataDirOf, openStateDatabase, readOwner, readStateDatabase, writeOwner, type StateDatabase } from './owner.js'
import { exportState, IMPORTED_SUFFIX, prepareDatabase, STATE_FILES } from './state-files.js'

describe('state database', { timeout: 120_000 }, () => {
  let dir: string
  let stateDir: string
  let logs: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-db-'))
    stateDir = join(dir, 'state')
    mkdirSync(stateDir)
    logs = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const dbDir = () => databaseDirOf(stateDir)
  const prepare = (beforeCommit?: (tx: Transaction) => Promise<void>) => prepareDatabase({ stateDir, log: (line) => logs.push(line), beforeCommit })
  const opened = async <T>(read: (db: PGlite) => Promise<T>, database?: Promise<StateDatabase>): Promise<T> => {
    const { db, close } = await (database ?? prepare())
    try {
      return await read(db)
    } finally {
      await close()
    }
  }
  const codeOf = (run: () => Promise<unknown>) =>
    run().then(
      () => undefined,
      (error: unknown) => noticeOf(error).code,
    )
  const listing = () => readdirSync(stateDir).sort()
  const tableExists = async (db: PGlite, name: string) => (await db.query<{ found: boolean }>('select to_regclass($1) is not null as found', [name])).rows[0]!.found
  const snapshot = (sessionId: string, at: string) => ({
    at,
    task: 'ABC-1',
    sessionId,
    previous: 'p',
    reason: 'relay' as const,
    prompt: 'go on',
    notePath: 'C:\\note.md',
    note: 'note',
  })

  it('makes an empty database when there are no files', async () => {
    await opened(async (db) => {
      expect(await databaseVersion(db)).toBe(DATABASE_VERSION)
      expect(await loadChainState(db)).toEqual(emptyChainState())
      expect(await readLaunches(db)).toEqual([])
    })
    expect(logs).toEqual([])
  })

  it('imports the handoff snapshots and leaves out one cut short', async () => {
    const handoffs = join(stateDir, STATE_FILES.handoffs)
    mkdirSync(handoffs)
    writeFileSync(join(handoffs, 's2.json'), JSON.stringify(snapshot('s2', '2026-10-02T00:00:00.000Z')))
    writeFileSync(join(handoffs, 's1.json'), JSON.stringify(snapshot('s1', '2026-10-01T00:00:00.000Z')))
    writeFileSync(join(handoffs, 's3.json'), '{"at": "2026')
    await opened(async (db) => expect(await readSnapshots(db)).toEqual([snapshot('s1', '2026-10-01T00:00:00.000Z'), snapshot('s2', '2026-10-02T00:00:00.000Z')]))
    expect(existsSync(`${handoffs}${IMPORTED_SUFFIX}`)).toBe(true)
    expect(logs.some((line) => line.includes('s3.json'))).toBe(true)
  })

  it('does not read a state file left next to the database, and says so', async () => {
    await (await prepare()).close()
    writeFileSync(join(stateDir, STATE_FILES.chain), JSON.stringify({ active: [], queue: ['ABC'], orders: {} }))
    await opened(async (db) => expect(await loadChainState(db)).toEqual(emptyChainState()))
    expect(logs).toEqual([expect.stringMatching(/chain\.json .* are not read/)])
  })

  it('refuses a database a newer Even Keel wrote and writes nothing', async () => {
    await opened((db) => db.query('update schema_version set version = 99'))
    expect(await codeOf(prepare)).toBe('storage.newerDatabase')
    expect(await codeOf(() => readStateDatabase(stateDir))).toBe('storage.newerDatabase')
    const db = await PGlite.create({ dataDir: dataDirOf(dbDir()) })
    expect(await databaseVersion(db)).toBe(99)
    await db.close()
  })

  it('brings a database of an older schema up step by step', async () => {
    await (await prepare()).close()
    await opened(async (db) => {
      expect(await databaseVersion(db)).toBe(DATABASE_VERSION + 1)
      expect(await tableExists(db, 'later')).toBe(true)
      await expect(checkVersion(db, 'later', DATABASE_VERSION + 2)).rejects.toThrow(/schema/)
    }, openStateDatabase(dbDir(), [...STEPS, 'create table later (x integer)']))
  })

  it('keeps a database that a broken step did not finish at its old version', async () => {
    await (await prepare()).close()
    await expect(openStateDatabase(dbDir(), [...STEPS, 'create table half (x integer); not sql'])).rejects.toThrow()
    await opened(async (db) => {
      expect(await databaseVersion(db)).toBe(DATABASE_VERSION)
      expect(await tableExists(db, 'half')).toBe(false)
    })
  })

  it('writes nothing when the import breaks midway', async () => {
    writeFileSync(join(stateDir, STATE_FILES.chain), JSON.stringify({ version: 9, active: [], queue: ['id-abc'], orders: {} }))
    writeFileSync(join(stateDir, STATE_FILES.launches), `{"version":9}\n{"at":"t","project":"id-abc","task":"ABC-1","sessionId":"s1"}\n`)
    const before = listing()
    let written = 0
    const breaking = async (tx: Transaction) => {
      written = (await readLaunches(tx)).length
      throw new Error('disk full')
    }
    expect(await codeOf(() => prepare(breaking))).toBe('storage.importFailed')
    expect(written).toBe(1)
    expect(listing()).toEqual(before)
  })

  it('refuses a damaged file and writes nothing', async () => {
    writeFileSync(join(stateDir, STATE_FILES.questions), '{"version": 9, "questions": [{"task": 5}]}')
    expect(await codeOf(prepare)).toBe('storage.damaged')
    expect(listing()).toEqual([STATE_FILES.questions])
    writeFileSync(join(stateDir, STATE_FILES.questions), '[]')
    writeFileSync(join(stateDir, STATE_FILES.chain), '{"version": 9, "active": 5}')
    expect(await codeOf(prepare)).toBe('storage.damaged')
    expect(listing()).toEqual([STATE_FILES.chain, STATE_FILES.questions])
  })

  it('refuses a file a newer Even Keel wrote and writes nothing', async () => {
    writeFileSync(join(stateDir, STATE_FILES.launches), `{"version":99}\n`)
    expect(await codeOf(prepare)).toBe('storage.newer')
    expect(listing()).toEqual([STATE_FILES.launches])
  })

  it('exports the state as files that the import reads back', async () => {
    const source = await memoryDatabase()
    const state = { ...emptyChainState(), active: [{ project: 'id-abc', current: null, paused: true, error: null }], queue: ['id-xyz'], orders: { 'id-abc': ['ABC-1'] } }
    await saveChainState(source, state)
    await saveQuestions(source, [{ task: 'ABC-1', sessionId: 's1', ask: 'a', comment: 'c', done: true }])
    await appendLaunch(source, { at: 't1', project: 'id-abc', task: 'ABC-1', sessionId: 's1', reason: 'handoff', model: 'opus' })
    await saveSnapshot(source, snapshot('s1', 't1'))
    await exportState(source, stateDir)
    await opened(async (db) => {
      expect(await loadChainState(db)).toEqual(await loadChainState(source))
      expect(await loadQuestions(db)).toEqual(await loadQuestions(source))
      expect(await readLaunches(db)).toEqual(await readLaunches(source))
      expect(await readSnapshots(db)).toEqual(await readSnapshots(source))
    })
    await source.close()
  })

  it('copies the database through its owner while it is open, closed tasks included', async () => {
    const owner = await prepare()
    const copy = join(dir, 'backup')
    try {
      await saveClosedTask(owner.db, { project: 'id-abc', task: 'ABC-1', tracker: 'huly', title: 'Done', url: null, closedAt: 't' })
      const reader = (await readStateDatabase(stateDir))!
      try {
        expect(reader.db).not.toBeInstanceOf(PGlite)
        await backupDatabase(reader.db, copy)
        await expect(backupDatabase(reader.db, copy)).rejects.toThrow(/exists/)
      } finally {
        await reader.close()
      }
    } finally {
      await owner.close()
    }
    await opened(async (db) => expect((await closedTasks(db)).map((task) => task.task)).toEqual(['ABC-1']), openStateDatabase(copy))
  })

  it('is opened by a reader when no one owns it, and served to the next reader meanwhile', async () => {
    expect(await readStateDatabase(stateDir)).toBeUndefined()
    await (await prepare()).close()
    const first = (await readStateDatabase(stateDir))!
    try {
      expect(first.db).toBeInstanceOf(PGlite)
      expect((await readOwner(dbDir()))?.pid).toBe(process.pid)
      await expect(openStateDatabase(dbDir())).rejects.toThrow(/holds the database/)
      const second = (await readStateDatabase(stateDir))!
      expect(second.db).not.toBeInstanceOf(PGlite)
      expect(await databaseVersion(second.db)).toBe(DATABASE_VERSION)
      await second.close()
    } finally {
      await first.close()
    }
    expect(await readOwner(dbDir())).toBeNull()
  })

  it('takes no notice of an owner left behind by a process that is gone', async () => {
    await (await prepare()).close()
    writeOwner(dbDir(), { pid: process.pid, port: 1 })
    expect(await readOwner(dbDir())).toBeNull()
    await opened(async (db) => expect(await databaseVersion(db)).toBe(DATABASE_VERSION))
  })
})
