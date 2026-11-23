import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { forgetProjectRows } from '../chain/store.js'
import { DatabaseHubStore } from '../link/hub-store.js'
import { HubEnd } from '../link/hub.js'
import { DatabaseMachineStore, openMachineDatabase, storedToken } from '../link/machine-store.js'
import { Assignments, fillPool, poolOf } from '../machine/assignments.js'
import { ownMachine } from '../machine/own.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf, XYZ } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS, Writes } from './database.js'
import { stateValue } from './service-state.js'

const MACHINE = '88888888-8888-4888-8888-888888888888'

const hubOf = (db: PGlite) => {
  const store = new DatabaseHubStore(db)
  return { store, hub: new HubEnd({ store, handlers: { event: () => {}, snapshot: () => {} }, log: () => {} }) }
}

describe('step 52: the machines of a project and the machine of a task (BTN-1216)', { timeout: 120_000 }, () => {
  it('makes the tables of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 50))
    try {
      await frozen.exec(fixture(52))
      expect(await databaseVersion(frozen)).toBe(52)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 52, 52)
      expect(await poolOf(frozen, ABC)).toEqual([MACHINE])
      const assignments = await Assignments.open({ db: frozen, writes: new Writes(() => {}), order: () => [] })
      expect(assignments.machineOf(ABC, 'ABC-2')).toBe(MACHINE)
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('takes the sample of the step before', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(51))
      await db.exec(STEPS[49]!)
      expect(await poolOf(db, ABC)).toEqual([])
      expect((await Assignments.open({ db, writes: new Writes(() => {}), order: () => [] })).of(MACHINE)).toEqual([])
    } finally {
      await db.close()
    }
  })

  it('makes the own machine of an installation of the version before, once', async () => {
    const db = await PGlite.create()
    const machineDb = await openMachineDatabase(undefined)
    try {
      await db.exec(fixture(51))
      await db.exec(STEPS[49]!)
      const { hub, store } = hubOf(db)
      const deps = { hub, hubStore: store, db, machineDb, name: 'This computer' }
      const token = await ownMachine(deps)
      expect(token.machine).not.toBe(MACHINE)
      expect(await stateValue(db, 'machines.own')).toBe(token.machine)
      expect(await store.machine(token.machine)).toMatchObject({ name: 'This computer', revokedAt: null })
      await fillPool(db, token.machine, [ABC, XYZ])
      expect(await poolOf(db, ABC)).toEqual([token.machine])
      expect(await poolOf(db, XYZ)).toEqual([token.machine])
      // The chain of the sample is as it was: the move touches nothing of it.
      await readsWhole(db, 51, 51)

      const line = await storedToken(machineDb)
      const machine = new DatabaseMachineStore(machineDb)
      await machine.appendEvent('example.started', 1)
      expect(await ownMachine(deps)).toEqual(token)
      expect(await storedToken(machineDb)).toBe(line)
      expect((await machine.eventsAfter(0, 10)).length).toBe(1)
      await fillPool(db, 'another-machine', [ABC])
      expect(await poolOf(db, ABC)).toEqual([token.machine])
    } finally {
      await Promise.all([db.close(), machineDb.close()])
    }
  })

  it('makes a new own machine when the two databases no longer agree, and revokes the old one', async () => {
    const db = await PGlite.create()
    const first = await openMachineDatabase(undefined)
    const second = await openMachineDatabase(undefined)
    try {
      await db.exec(fixture(52))
      const { hub, store } = hubOf(db)
      const old = await ownMachine({ hub, hubStore: store, db, machineDb: first, name: 'This computer' })
      const fresh = await ownMachine({ hub, hubStore: store, db, machineDb: second, name: 'This computer' })
      expect(fresh.machine).not.toBe(old.machine)
      expect((await store.machine(old.machine))?.revokedAt).not.toBeNull()
      expect(await stateValue(db, 'machines.own')).toBe(fresh.machine)
      // The folder that kept the old token finds it revoked and takes a new one as well.
      const again = await ownMachine({ hub, hubStore: store, db, machineDb: first, name: 'This computer' })
      expect(again.machine).not.toBe(old.machine)
      expect((await store.machine(fresh.machine))?.revokedAt).not.toBeNull()
    } finally {
      await Promise.all([db.close(), first.close(), second.close()])
    }
  })

  it('hands the pools of the replaced own machine to the new one, its tasks left for a person to move', async () => {
    const db = await PGlite.create()
    const first = await openMachineDatabase(undefined)
    const second = await openMachineDatabase(undefined)
    try {
      await db.exec(fixture(52))
      await db.exec(STEPS.slice(50).join('\n'))
      const { hub, store } = hubOf(db)
      const old = await ownMachine({ hub, hubStore: store, db, machineDb: first, name: 'This computer' })
      await db.query('delete from project_machines')
      await db.query(`insert into project_machines (project_id, machine_id, enabled, settings, after_green) values ($1, $2, true, '{"commands":["make"]}', 'abc123'), ($3, $2, false, null, null)`, [ABC, old.machine, XYZ])
      await db.query(`insert into project_machines (project_id, machine_id) values ($1, 'another-machine')`, [ABC])
      await db.query('update machine_tasks set machine_id = $1', [old.machine])
      // The state database restored on another host: its machine's folder is not there.
      const fresh = await ownMachine({ hub, hubStore: store, db, machineDb: second, name: 'This computer' })
      const { rows } = await db.query<{ project_id: string; machine_id: string; enabled: boolean; settings: unknown; after_green: string | null }>(
        'select project_id, machine_id, enabled, settings, after_green from project_machines order by project_id, machine_id',
      )
      expect(rows).toEqual(
        [
          { project_id: ABC, machine_id: fresh.machine, enabled: true, settings: '{"commands":["make"]}', after_green: 'abc123' },
          { project_id: ABC, machine_id: 'another-machine', enabled: true, settings: null, after_green: null },
          { project_id: XYZ, machine_id: fresh.machine, enabled: false, settings: null, after_green: null },
        ].sort((a, b) => a.project_id.localeCompare(b.project_id) || a.machine_id.localeCompare(b.machine_id)),
      )
      const assignments = await Assignments.open({ db, writes: new Writes(() => {}), order: () => [] })
      expect(assignments.machineOf(ABC, 'ABC-2')).toBe(old.machine)
    } finally {
      await Promise.all([db.close(), first.close(), second.close()])
    }
  })

  it('keeps the machine of a task until its place is cleaned up and names the tasks in the order of the chain', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(52))
      // `forgetProjectRows` clears every table of the current schema, so the sample is brought to it: the handoff notes of step 53, the memory of step 54, the moves of step 57 among them.
      for (const step of STEPS.slice(50)) await db.exec(step)
      const writes = new Writes(() => {})
      let at = 100
      const deps = { db, writes, order: (project: string) => (project === ABC ? ['ABC-1', 'ABC-2', 'ABC-3'] : []), now: () => at++ }
      const assignments = await Assignments.open(deps)
      assignments.assign(ABC, 'ABC-7', MACHINE)
      assignments.assign(ABC, 'ABC-3', MACHINE)
      assignments.assign(ABC, 'ABC-1', 'another-machine')
      assignments.assign(XYZ, 'XYZ-7', MACHINE)
      assignments.assign(ABC, 'ABC-3', MACHINE)
      expect(await assignments.assigned(MACHINE)).toEqual([
        { project: ABC, task: 'ABC-2' },
        { project: ABC, task: 'ABC-3' },
        { project: ABC, task: 'ABC-7' },
        { project: XYZ, task: 'XYZ-7' },
      ])
      assignments.release(ABC, 'ABC-2')
      assignments.release(ABC, 'ABC-2')
      await writes.settled()
      const reopened = await Assignments.open(deps)
      expect(reopened.of(MACHINE)).toEqual([{ project: ABC, task: 'ABC-7' }, { project: ABC, task: 'ABC-3' }, { project: XYZ, task: 'XYZ-7' }])
      expect(reopened.machineOf(ABC, 'ABC-1')).toBe('another-machine')
      expect(reopened.machineOf(ABC, 'ABC-2')).toBeUndefined()

      await forgetProjectRows(db, ABC)
      expect((await Assignments.open(deps)).of(MACHINE)).toEqual([{ project: XYZ, task: 'XYZ-7' }])
      expect(await poolOf(db, ABC)).toEqual([])
    } finally {
      await db.close()
    }
  })
})
