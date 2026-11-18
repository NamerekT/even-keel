import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { loadMail } from '../sessions/mailbox.js'
import { adoptMail, saveMailboxChange } from '../sessions/mailbox-store.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, mailboxOf, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

const SERVER = '88888888-8888-4888-8888-888888888888'
const LAPTOP = '99999999-9999-4999-8999-999999999999'
const keys = async (db: PGlite) =>
  (await db.query<{ id: number; machine_id: string | null }>('select id, machine_id from mailbox order by id, machine_id')).rows

describe('step 62: a mailbox message keyed by its machine and its number (BTN-1284)', { timeout: 120_000 }, () => {
  it('makes the key of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 60))
    try {
      await frozen.exec(fixture(62))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 62, 62)
      expect((await mailboxOf(frozen)).waiting).toEqual(['And run the slow tests.'])
      expect(await keys(frozen)).toEqual([
        { id: 1, machine_id: null },
        { id: 2, machine_id: SERVER },
        { id: 2, machine_id: LAPTOP },
        { id: 3, machine_id: SERVER },
      ])
      expect((await loadMail(frozen, LAPTOP)).map((mail) => mail.text)).toEqual(["Take the laptop's folder."])
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('takes a number another machine has used over the sample of step 61, and gives its unowned rows to the own machine', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(61))
      await db.exec(STEPS[59]!)
      const [second] = await loadMail(db, SERVER)
      await saveMailboxChange(db, { mails: [{ ...second!, text: 'Posted on the laptop.', fate: 'waiting', reason: null, settledAt: null }] }, LAPTOP)
      expect((await loadMail(db, LAPTOP)).map((mail) => [mail.id, mail.text])).toEqual([[2, 'Posted on the laptop.']])
      expect((await loadMail(db, SERVER)).map((mail) => [mail.id, mail.text])).toEqual([[2, 'Mind the second case too.'], [3, 'And run the slow tests.']])
      await adoptMail(db, SERVER)
      expect((await loadMail(db, SERVER)).map((mail) => mail.id)).toEqual([1, 2, 3])
    } finally {
      await db.close()
    }
  })
})
