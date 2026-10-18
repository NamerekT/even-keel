import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { fixEpisodes, isLaunch } from '../chain/launches.js'
import { readSnapshots } from '../chain/snapshots.js'
import { closedTasks, loadChainState, loadQuestions, readLaunches } from '../chain/store.js'
import { root } from '../locations.js'
import { Mailbox } from '../sessions/mailbox.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

// The frozen sample of the database at schema step 1: a later step must migrate it, and step 1 itself must still make
// exactly its tables. A schema change is a new step and a new sample next to this one, never an edit of either.
const sample = readFileSync(join(root, 'test', 'fixtures', 'database-v1', 'even-keel.sql'), 'utf8')

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'

describe('frozen sample of the database at step 1', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('has the tables step 1 makes', () => {
    const frozen = new DatabaseSync(':memory:')
    frozen.exec(sample)
    const made = openDatabase(':memory:', STEPS.slice(0, 1))
    expect(databaseVersion(frozen)).toBe(1)
    expect(schemaOf(made)).toEqual(schemaOf(frozen))
  })

  it('is brought to the current schema and read whole', () => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-db-sample-'))
    const file = join(dir, 'even-keel.db')
    const frozen = new DatabaseSync(file)
    frozen.exec(sample)
    frozen.close()
    const db = openDatabase(file)
    try {
      expect(databaseVersion(db)).toBe(STEPS.length)
      const state = loadChainState(db, { ABC, XYZ })
      expect(state.active.map((chain) => [chain.project, chain.current?.task])).toEqual([['ABC', 'ABC-2']])
      expect(state.queue).toEqual(['XYZ'])
      expect(state.orders).toEqual({ ABC: ['ABC-1', 'ABC-2', 'ABC-3'], XYZ: ['XYZ-7'] })
      expect(state.skipped).toEqual({ ABC: ['ABC-9'] })
      expect(state.leftovers.XYZ?.[0]?.task).toBe('XYZ-1')
      expect(state.released).toEqual({ ABC: ['ABC-1'] })
      expect(state.ci.ABC?.afterGreen).toBe(state.ci.ABC?.green)
      expect(loadQuestions(db).map((question) => question.task)).toEqual(['ABC-2'])
      const launches = readLaunches(db, { ABC, XYZ })
      expect(launches.filter(isLaunch).map((entry) => entry.task)).toEqual(['ABC-1', 'ABC-2', 'ABC-FIX', 'ABC-FIX'])
      expect(launches[0]?.fallback).toBe('codex')
      expect(fixEpisodes(launches).episodes.ABC?.map((episode) => [episode.id, episode.end?.how])).toEqual([
        ['ABC-FIX.1', 'landed'],
        ['ABC-FIX.2', 'dropped'],
      ])
      const [snapshot] = readSnapshots(db)
      expect(snapshot).toMatchObject({ task: 'ABC-2', reason: 'relay', notePath: 'C:\\repos\\example-project\\.temp\\handoff.md' })
      expect(snapshot?.note).toContain('Done: the parser.')
      expect(closedTasks(db, { ABC, XYZ })).toEqual([
        { project: 'ABC', task: 'ABC-1', tracker: 'huly', title: 'Parse the example input', url: 'https://huly.example.com/workbench/example/browse/ABC-1', closedAt: '2026-10-04T12:00:00.000Z' },
      ])
      expect(new Mailbox(db, () => new Date()).waiting()).toEqual([])
    } finally {
      db.close()
    }
  })
})

const sampleV2 = readFileSync(join(root, 'test', 'fixtures', 'database-v2', 'even-keel.sql'), 'utf8')

describe('frozen sample of the database at step 2', () => {
  it('has the tables steps 1 and 2 make', () => {
    const frozen = new DatabaseSync(':memory:')
    frozen.exec(sampleV2)
    const made = openDatabase(':memory:', STEPS.slice(0, 2))
    expect(databaseVersion(frozen)).toBe(2)
    expect(schemaOf(made)).toEqual(schemaOf(frozen))
  })

  it('is brought to the current schema with its mailbox', () => {
    const dir = mkdtempSync(join(tmpdir(), 'even-keel-db-sample-'))
    const file = join(dir, 'even-keel.db')
    const frozen = new DatabaseSync(file)
    frozen.exec(sampleV2)
    frozen.close()
    const db = openDatabase(file)
    try {
      expect(databaseVersion(db)).toBe(STEPS.length)
      expect(loadChainState(db, { ABC, XYZ }).active.map((chain) => chain.current?.task)).toEqual(['ABC-2'])
      const mailbox = new Mailbox(db, () => new Date('2026-10-18T10:10:00.000Z'))
      expect(mailbox.waiting().map((mail) => mail.text)).toEqual(['And run the slow tests.'])
      expect(mailbox.of('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee').map((mail) => [mail.fate, mail.event, mail.files])).toEqual([
        ['delivered', 'PostToolUse', []],
        ['returned', null, ['C:\\repos\\example-project\\.temp\\inbox\\case.png']],
        ['waiting', null, []],
      ])
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function schemaOf(db: DatabaseSync) {
  return (db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all() as { name: string; sql: string }[]).map(({ name, sql }) => [
    name,
    sql.replace(/\s+/g, ' '),
  ])
}
