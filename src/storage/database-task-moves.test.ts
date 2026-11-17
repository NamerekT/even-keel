import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { TaskMoves } from '../machine/task-moves.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS, Writes } from './database.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const LAPTOP = '99999999-9999-4999-8999-999999999999'

const writesOf = (): Writes => new Writes(() => {})

describe('step 57: the tasks moved by hand off a machine gone (BTN-1270)', { timeout: 120_000 }, () => {
  it('makes the table of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 55))
    try {
      await frozen.exec(fixture(57))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 57, 57)
      const moves = await TaskMoves.open({ db: frozen, writes: writesOf() })
      expect(moves.of(PROJECT, 'ABC-2')).toMatchObject({ from: LAPTOP, branch: 'abc-2/task', launched: true })
      expect(moves.of(PROJECT, 'ABC-3')).toMatchObject({ from: LAPTOP, branch: 'abc-3/task', launched: false })
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('keeps a move, its launch and its end over a reopening', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(56))
      await db.exec(STEPS[54]!)
      const writes = writesOf()
      const moves = await TaskMoves.open({ db, writes, now: () => 1_794_650_000_000 })
      moves.add(PROJECT, 'ABC-5', LAPTOP, 'abc-5/task')
      moves.add(PROJECT, 'ABC-6', LAPTOP, 'abc-6/task')
      moves.launched(PROJECT, 'ABC-5')
      moves.drop(PROJECT, 'ABC-6')
      await writes.settled()
      const again = await TaskMoves.open({ db, writes: writesOf() })
      expect(again.of(PROJECT, 'ABC-5')).toEqual({ project: PROJECT, task: 'ABC-5', from: LAPTOP, branch: 'abc-5/task', at: 1_794_650_000_000, launched: true })
      expect(again.from(PROJECT, 'ABC-6')).toBeUndefined()
    } finally {
      await db.close()
    }
  })
})
