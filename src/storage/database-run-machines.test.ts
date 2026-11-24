import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { loadTaskRuns, saveTaskRun } from '../sessions/runs-store.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const SERVER = '88888888-8888-4888-8888-888888888888'

it('step 78 keeps the machines a task is pinned to; the runs before it have none (BTN-1623)', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 76))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(78))
    expect(await databaseVersion(frozen)).toBe(78)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 78, 78)
    expect(await loadTaskRuns(frozen)).toEqual([
      { project: ABC, task: 'ABC-2', provider: 'claude', model: 'opus', effort: 'high' },
      { project: ABC, task: 'ABC-3', provider: null, model: null, effort: 'low', machines: [SERVER] },
    ])
    await upgraded.exec(fixture(77))
    await upgraded.exec(STEPS[75]!)
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
    expect(await loadTaskRuns(upgraded)).toEqual([
      { project: ABC, task: 'ABC-2', provider: 'claude', model: 'opus', effort: 'high' },
      { project: ABC, task: 'ABC-3', provider: null, model: null, effort: 'low' },
    ])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('a pin is saved, replaced and cleared with its run', { timeout: 120_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    await saveTaskRun(db, { project: ABC, task: 'ABC-1', provider: null, model: null, effort: null, machines: [SERVER, 'other'] })
    expect(await loadTaskRuns(db)).toEqual([{ project: ABC, task: 'ABC-1', provider: null, model: null, effort: null, machines: [SERVER, 'other'] }])
    await saveTaskRun(db, { project: ABC, task: 'ABC-1', provider: 'codex', model: null, effort: null })
    expect(await loadTaskRuns(db)).toEqual([{ project: ABC, task: 'ABC-1', provider: 'codex', model: null, effort: null }])
  } finally {
    await db.close()
  }
})
