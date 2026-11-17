import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { DatabaseHubStore } from '../link/hub-store.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

const SERVER = '88888888-8888-4888-8888-888888888888'
const LAPTOP = '99999999-9999-4999-8999-999999999999'

describe('step 56: the capacity of a machine elsewhere (BTN-993)', { timeout: 120_000 }, () => {
  it('makes the column of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 54))
    try {
      await frozen.exec(fixture(56))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 56, 56)
      const store = new DatabaseHubStore(frozen)
      expect((await store.machine(SERVER))?.capacity).toBe(2)
      expect((await store.machine(LAPTOP))?.capacity).toBe(1)
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('gives the machines of the step before a capacity of one, and keeps a new one', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(55))
      await db.exec(STEPS[53]!)
      const store = new DatabaseHubStore(db)
      for (const machine of await store.listMachines()) expect(machine.capacity).toBe(1)
      await store.setCapacity(SERVER, 3)
      expect((await store.machine(SERVER))?.capacity).toBe(3)
    } finally {
      await db.close()
    }
  })
})
