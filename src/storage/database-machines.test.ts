import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { DatabaseHubStore } from '../link/hub-store.js'
import { hubIdentity } from '../link/identity.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const MACHINE = '88888888-8888-4888-8888-888888888888'

describe("step 51: the hub's machines and their commands (BTN-988)", { timeout: 120_000 }, () => {
  it('makes the tables of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 49))
    try {
      await frozen.exec(fixture(51))
      expect(await databaseVersion(frozen)).toBe(51)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 51, 51)
      const store = new DatabaseHubStore(frozen)
      expect(await store.machine(MACHINE)).toMatchObject({ name: 'Example server', host: 'example-host', revokedAt: null, lastEvent: 7 })
      expect(await store.commandsAfter(MACHINE, 0)).toEqual([{ seq: 3, type: 'example.run', project: ABC, folder: 'C:/repos/example' }])
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('takes the sample of the step before', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(50))
      await db.exec(STEPS[48]!)
      expect(await new DatabaseHubStore(db).machine(MACHINE)).toBeUndefined()
    } finally {
      await db.close()
    }
  })

  it('numbers the commands of a machine on from the last one, also after they are dropped', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(51))
      const store = new DatabaseHubStore(db)
      expect(await store.addCommand(MACHINE, { type: 'example.stop' }, 1)).toBe(4)
      await store.dropCommands(MACHINE, 4)
      expect(await store.commandsAfter(MACHINE, 0)).toEqual([])
      expect(await store.addCommand(MACHINE, { type: 'example.stop', payload: { why: 'test' } }, 2)).toBe(5)
      expect(await store.commandsAfter(MACHINE, 4)).toEqual([{ seq: 5, type: 'example.stop', payload: { why: 'test' } }])
      await expect(store.addCommand('no-such-machine', { type: 'example.stop' }, 3)).rejects.toThrow('no machine')
    } finally {
      await db.close()
    }
  })

  it('keeps the last event taken and never moves it back, and a revoked machine stays revoked', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(51))
      const store = new DatabaseHubStore(db)
      await store.eventTaken(MACHINE, 9)
      await store.eventTaken(MACHINE, 8)
      expect((await store.machine(MACHINE))?.lastEvent).toBe(9)
      await store.revoke(MACHINE, 100)
      await store.revoke(MACHINE, 200)
      expect((await store.machine(MACHINE))?.revokedAt).toBe(100)
      await store.addMachine({ id: 'second', name: 'Second', secretHash: 'hash', createdAt: 5 })
      await store.seen('second', 'other-host', 1, 6)
      expect(await store.machine('second')).toEqual({ id: 'second', name: 'Second', secretHash: 'hash', createdAt: 5, revokedAt: null, host: 'other-host', lastEvent: 0 })
    } finally {
      await db.close()
    }
  })

  it("makes the hub's certificate once and gives the same one afterwards", async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(51))
      const first = await hubIdentity(db)
      expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/)
      expect(await hubIdentity(db)).toEqual(first)
    } finally {
      await db.close()
    }
  })
})
