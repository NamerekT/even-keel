import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { DatabaseHubStore } from '../link/hub-store.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

const SERVER = '88888888-8888-4888-8888-888888888888'
const LAPTOP = '99999999-9999-4999-8999-999999999999'

describe("step 59: a machine's colour (BTN-1272)", { timeout: 120_000 }, () => {
  it('adds the column of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 57))
    try {
      await frozen.exec(fixture(59))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 59, 59)
      const store = new DatabaseHubStore(frozen)
      expect((await store.machine(SERVER))?.color).toBe('#6f8f7f')
      expect((await store.machine(LAPTOP))?.color).toBeNull()
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('leaves the machines of the step before without a colour, and keeps a new one', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(58))
      await db.exec(STEPS[56]!)
      const store = new DatabaseHubStore(db)
      for (const machine of await store.listMachines()) expect(machine.color).toBeNull()
      await store.setColor(LAPTOP, '#8a8f5c')
      expect((await store.machine(LAPTOP))?.color).toBe('#8a8f5c')
      await store.setColor(LAPTOP, null)
      expect((await store.machine(LAPTOP))?.color).toBeNull()
    } finally {
      await db.close()
    }
  })
})
