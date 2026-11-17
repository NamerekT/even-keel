import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { MACHINE_STEPS } from '../link/machine-store.js'
import { openDatabase } from '../storage/database.js'
import { schemaOf } from '../storage/database.fixture.js'

it('upgrades the previous machine schema without losing its connection or outbox', { timeout: 120_000 }, async () => {
  const db = await openDatabase(undefined, MACHINE_STEPS.slice(0, 3))
  const frozen = new PGlite()
  try {
    await db.exec("insert into identity values ('token', 'fake-token'); insert into outbox (type, at) values ('example', 123)")
    await db.exec(MACHINE_STEPS[3]!)
    await frozen.exec(await readFile(new URL('../../test/fixtures/machine-v6/machine.sql', import.meta.url), 'utf8'))
    expect(await schemaOf(db)).toEqual(await schemaOf(frozen))
    expect((await db.query('select * from identity')).rows).toEqual([{ key: 'token', value: 'fake-token' }])
    expect((await db.query('select type from outbox')).rows).toEqual([{ type: 'example' }])
  } finally {
    await Promise.all([db.close(), frozen.close()])
  }
})

it('adds the Tally read marks to a machine of schema v6', { timeout: 120_000 }, async () => {
  const db = await openDatabase(undefined, MACHINE_STEPS.slice(0, 4))
  const frozen = new PGlite()
  try {
    await db.exec("insert into identity values ('token', 'fake-token')")
    await db.exec(MACHINE_STEPS[4]!)
    await frozen.exec(await readFile(new URL('../../test/fixtures/machine-v7/machine.sql', import.meta.url), 'utf8'))
    expect(await schemaOf(db)).toEqual(await schemaOf(frozen))
    expect((await db.query('select * from identity')).rows).toEqual([{ key: 'token', value: 'fake-token' }])
  } finally {
    await Promise.all([db.close(), frozen.close()])
  }
})
