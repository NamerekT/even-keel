import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { DatabaseHubStore } from '../link/hub-store.js'
import type { MachineAbout } from '../link/protocol.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

const JOINED = '88888888-8888-4888-8888-888888888888'
const INVITED = '99999999-9999-4999-8999-999999999999'
const ABOUT: MachineAbout = {
  host: 'example-laptop', os: 'darwin 24.1.0', evenKeel: '0.4.0', node: '24.11.0', git: null, agents: { claude: null }, gitUser: false, root: '/Users/example/projects',
}

describe('step 55: the machines that join with a connection string (BTN-1242)', { timeout: 120_000 }, () => {
  it('makes the columns of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 53))
    try {
      await frozen.exec(fixture(55))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 55, 55)
      const store = new DatabaseHubStore(frozen)
      expect(await store.machine(JOINED)).toMatchObject({ joinedAt: 1794650050000, inviteExpires: 1794651800000, about: { root: '/home/example/projects', gitUser: true } })
      expect(await store.machine(INVITED)).toMatchObject({ joinedAt: null, inviteExpires: 1794653800000, about: null })
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('takes the sample of the step before, its machines without a string', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(54))
      await db.exec(STEPS[52]!)
      const machines = await new DatabaseHubStore(db).listMachines()
      expect(machines.length).toBeGreaterThan(0)
      for (const machine of machines) expect(machine).toMatchObject({ inviteExpires: null, joinedAt: null, about: null })
    } finally {
      await db.close()
    }
  })

  it('lets a string join once, keeps what the machine told and a machine made without a string', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(55))
      const store = new DatabaseHubStore(db)
      expect(await store.joined(INVITED, 'own-hash', ABOUT, 1794652500000)).toBe(true)
      expect(await store.joined(INVITED, 'other-hash', ABOUT, 1794652600000)).toBe(false)
      expect(await store.machine(INVITED)).toMatchObject({ secretHash: 'own-hash', joinedAt: 1794652500000, about: ABOUT })
      await store.described(INVITED, { ...ABOUT, gitUser: true })
      expect((await store.machine(INVITED))?.about?.gitUser).toBe(true)
      await store.addMachine({ id: 'second', name: 'Second', secretHash: 'hash', createdAt: 5 })
      await store.seen('second', 'other-host', 6, 6)
      expect(await store.machine('second')).toEqual({
        id: 'second', name: 'Second', secretHash: 'hash', createdAt: 5, revokedAt: null, host: 'other-host', lastEvent: 0, inviteExpires: null, joinedAt: null, about: null,
      })
      await store.revoke('second', 7)
      await store.addMachine({ id: 'third', name: 'Third', secretHash: 'hash', createdAt: 8, inviteExpires: 9 })
      await store.revoke('third', 9)
      expect(await store.joined('third', 'own-hash', ABOUT, 10)).toBe(false)
      expect((await store.listMachines()).map((machine) => machine.id)).toEqual(['second', 'third', JOINED, INVITED])
    } finally {
      await db.close()
    }
  })
})
