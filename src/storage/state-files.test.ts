import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyChainState } from '../chain/dispatcher.js'
import { readSnapshots, saveSnapshot } from '../chain/snapshots.js'
import { appendLaunch, chainStateOf, closedTasks, loadChainState, loadQuestions, readLaunches, saveChainState, saveClosedTask, saveQuestions } from '../chain/store.js'
import { root } from '../locations.js'
import { noticeOf } from '../notice/notice.js'
import { DATABASE_FILE, databaseVersion, openDatabase, readDatabase, STEPS } from './database.js'
import { upgradeStorage } from './migrations.js'
import { backupDatabase, exportState, IMPORTED_SUFFIX, prepareDatabase, readStateFiles, STATE_FILES } from './state-files.js'

describe('state database', () => {
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

  const dbFile = () => join(stateDir, DATABASE_FILE)
  const prepare = (beforeCommit?: (db: DatabaseSync) => void) => prepareDatabase({ stateDir, log: (line) => logs.push(line), beforeCommit })
  const opened = <T>(read: (db: DatabaseSync) => T): T => {
    const db = openDatabase(dbFile())
    try {
      return read(db)
    } finally {
      db.close()
    }
  }
  const codeOf = (run: () => void) => {
    try {
      run()
    } catch (error) {
      return noticeOf(error).code
    }
    return undefined
  }
  const listing = () => readdirSync(stateDir).sort()
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

  describe.each([2, 3, 4, 5, 6, 7, 8, 9])('the frozen sample of schema v%i', (version) => {
    it('moves into the database whole, keeps the files as imported and does it once', () => {
      cpSync(join(root, 'test', 'fixtures', `schema-v${version}`), dir, { recursive: true })
      upgradeStorage({ configFile: join(dir, 'even-keel.config.json'), stateDir, log: () => {} })
      const files = readStateFiles(stateDir)!
      prepare()
      opened((db) => {
        expect(loadChainState(db)).toEqual(chainStateOf(files.chain, {}, 'chain.json'))
        expect(loadQuestions(db)).toEqual(files.questions)
        expect(readLaunches(db)).toEqual(files.launches)
        expect(readLaunches(db).length).toBeGreaterThan(0)
      })
      for (const name of [STATE_FILES.chain, STATE_FILES.questions, STATE_FILES.launches]) {
        expect(existsSync(join(stateDir, name))).toBe(false)
        expect(existsSync(join(stateDir, `${name}${IMPORTED_SUFFIX}`))).toBe(true)
      }
      expect(logs).toEqual([expect.stringMatching(/moved the state into/)])
      const before = listing()
      prepare()
      expect(listing()).toEqual(before)
      expect(logs).toHaveLength(1)
    })
  })

  it('makes an empty database when there are no files', () => {
    prepare()
    opened((db) => {
      expect(databaseVersion(db)).toBe(STEPS.length)
      expect(loadChainState(db)).toEqual(emptyChainState())
      expect(readLaunches(db)).toEqual([])
    })
    expect(logs).toEqual([])
  })

  it('imports the handoff snapshots and leaves out one cut short', () => {
    const handoffs = join(stateDir, STATE_FILES.handoffs)
    mkdirSync(handoffs)
    writeFileSync(join(handoffs, 's2.json'), JSON.stringify(snapshot('s2', '2026-10-02T00:00:00.000Z')))
    writeFileSync(join(handoffs, 's1.json'), JSON.stringify(snapshot('s1', '2026-10-01T00:00:00.000Z')))
    writeFileSync(join(handoffs, 's3.json'), '{"at": "2026')
    prepare()
    opened((db) => expect(readSnapshots(db)).toEqual([snapshot('s1', '2026-10-01T00:00:00.000Z'), snapshot('s2', '2026-10-02T00:00:00.000Z')]))
    expect(existsSync(`${handoffs}${IMPORTED_SUFFIX}`)).toBe(true)
    expect(logs.some((line) => line.includes('s3.json'))).toBe(true)
  })

  it('does not read a state file left next to the database, and says so', () => {
    prepare()
    writeFileSync(join(stateDir, STATE_FILES.chain), JSON.stringify({ active: [], queue: ['ABC'], orders: {} }))
    prepare()
    opened((db) => expect(loadChainState(db)).toEqual(emptyChainState()))
    expect(logs).toEqual([expect.stringMatching(/chain\.json .* are not read/)])
  })

  it('refuses a database a newer Even Keel wrote and writes nothing', () => {
    const db = new DatabaseSync(dbFile())
    db.exec(`PRAGMA user_version = ${STEPS.length + 1}`)
    db.close()
    const before = readFileSync(dbFile())
    expect(codeOf(prepare)).toBe('storage.newerDatabase')
    expect(readFileSync(dbFile())).toEqual(before)
    expect(codeOf(() => readDatabase(dbFile()))).toBe('storage.newerDatabase')
  })

  it('brings a database of an older schema up step by step', () => {
    const steps = [...STEPS, 'CREATE TABLE later (x INTEGER)']
    openDatabase(dbFile()).close()
    const db = openDatabase(dbFile(), steps)
    expect(databaseVersion(db)).toBe(steps.length)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'later'").all()).toHaveLength(1)
    db.close()
    expect(() => readDatabase(dbFile(), steps.length + 1)).toThrow(/schema/)
  })

  it('keeps a database that a broken step did not finish at its old version', () => {
    openDatabase(dbFile()).close()
    expect(() => openDatabase(dbFile(), [...STEPS, 'CREATE TABLE half (x INTEGER); NOT SQL'])).toThrow()
    opened((db) => {
      expect(databaseVersion(db)).toBe(STEPS.length)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").all()).toHaveLength(0)
    })
  })

  it('writes nothing when the import breaks midway', () => {
    writeFileSync(join(stateDir, STATE_FILES.chain), JSON.stringify({ version: 9, active: [], queue: ['id-abc'], orders: {} }))
    writeFileSync(join(stateDir, STATE_FILES.launches), `{"version":9}\n{"at":"t","project":"id-abc","task":"ABC-1","sessionId":"s1"}\n`)
    const before = listing()
    let written = 0
    const breaking = (db: DatabaseSync) => {
      written = readLaunches(db).length
      throw new Error('disk full')
    }
    expect(codeOf(() => prepare(breaking))).toBe('storage.importFailed')
    expect(written).toBe(1)
    expect(listing()).toEqual(before)
  })

  it('refuses a damaged file and writes nothing', () => {
    writeFileSync(join(stateDir, STATE_FILES.questions), '{"version": 9, "questions": [{"task": 5}]}')
    expect(codeOf(prepare)).toBe('storage.damaged')
    expect(listing()).toEqual([STATE_FILES.questions])
    writeFileSync(join(stateDir, STATE_FILES.questions), '[]')
    writeFileSync(join(stateDir, STATE_FILES.chain), '{"version": 9, "active": 5}')
    expect(codeOf(prepare)).toBe('storage.damaged')
    expect(listing()).toEqual([STATE_FILES.chain, STATE_FILES.questions])
  })

  it('refuses a file a newer Even Keel wrote and writes nothing', () => {
    writeFileSync(join(stateDir, STATE_FILES.launches), `{"version":99}\n`)
    expect(codeOf(prepare)).toBe('storage.newer')
    expect(listing()).toEqual([STATE_FILES.launches])
  })

  it('exports the state as files that the import reads back', () => {
    const source = openDatabase(':memory:')
    const state = { ...emptyChainState(), active: [{ project: 'id-abc', current: null, paused: true, error: null }], queue: ['id-xyz'], orders: { 'id-abc': ['ABC-1'] } }
    saveChainState(source, state)
    saveQuestions(source, [{ task: 'ABC-1', sessionId: 's1', ask: 'a', comment: 'c', done: true }])
    appendLaunch(source, { at: 't1', project: 'id-abc', task: 'ABC-1', sessionId: 's1', reason: 'handoff', model: 'opus' })
    saveSnapshot(source, snapshot('s1', 't1'))
    exportState(source, stateDir)
    prepare()
    opened((db) => {
      expect(loadChainState(db)).toEqual(loadChainState(source))
      expect(loadQuestions(db)).toEqual(loadQuestions(source))
      expect(readLaunches(db)).toEqual(readLaunches(source))
      expect(readSnapshots(db)).toEqual(readSnapshots(source))
    })
  })

  it('copies the database while it is open, closed tasks included', () => {
    prepare()
    const db = openDatabase(dbFile())
    saveClosedTask(db, { project: 'id-abc', task: 'ABC-1', tracker: 'huly', title: 'Done', url: null, closedAt: 't' })
    const copy = join(dir, 'backup', 'copy.db')
    mkdirSync(join(dir, 'backup'))
    backupDatabase(db, copy)
    expect(() => backupDatabase(db, copy)).toThrow(/exists/)
    db.close()
    const restored = readDatabase(copy)!
    expect(closedTasks(restored).map((task) => task.task)).toEqual(['ABC-1'])
    restored.close()
  })
})
