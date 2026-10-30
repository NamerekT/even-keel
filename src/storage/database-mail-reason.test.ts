import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { Mailbox } from '../sessions/mailbox.js'
import { databaseVersion, openDatabase, STEPS, Writes } from './database.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'

const reasons = async (db: PGlite) => {
  const mailbox = await Mailbox.open(db, new Writes(() => {}), () => new Date('2026-10-18T10:10:00.000Z'))
  return mailbox.of('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee').map((mail) => [mail.fate, mail.reason])
}

it('step 22 keeps why a chat message came back, null on one returned before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined)
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(22))
    expect(await databaseVersion(frozen)).toBe(22)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 22)
    expect(await reasons(frozen)).toEqual([['delivered', null], ['returned', 'asked'], ['waiting', null]])
    await upgraded.exec(fixture(21))
    await upgraded.exec(STEPS[19]!)
    expect(await reasons(upgraded)).toEqual([['delivered', null], ['returned', null], ['waiting', null]])
    await expect(upgraded.exec("update mailbox set reason = 'lost' where id = 2")).rejects.toThrow()
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
