import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { saveMailboxChange } from '../sessions/mailbox-store.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, mailboxOf, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

const SERVER = '88888888-8888-4888-8888-888888888888'
const LAPTOP = '99999999-9999-4999-8999-999999999999'
const machines = async (db: PGlite) => (await db.query<{ id: number; machine_id: string | null }>('select id, machine_id from mailbox order by id')).rows

describe('step 61: the machine of each mailbox message (BTN-1251)', { timeout: 120_000 }, () => {
  it('adds the column of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 59))
    try {
      await frozen.exec(fixture(61))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 61, 61)
      expect((await mailboxOf(frozen)).waiting).toEqual(['And run the slow tests.'])
      expect(await machines(frozen)).toEqual([{ id: 1, machine_id: null }, { id: 2, machine_id: SERVER }, { id: 3, machine_id: SERVER }])
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it("leaves the messages of the step before to any machine's cleanup", async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(60))
      await db.exec(STEPS[58]!)
      expect((await machines(db)).map((row) => row.machine_id)).toEqual([null, null, null])
      await saveMailboxChange(db, { mails: [], before: '2026-10-18T10:05:10.000Z' }, LAPTOP)
      expect((await machines(db)).map((row) => row.id)).toEqual([2, 3])
    } finally {
      await db.close()
    }
  })
})
