import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { emptyChainState } from '../chain/model.js'
import { loadChainState, saveChainState } from '../chain/store.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'

it('step 77 lets the chain lists keep the landings of tasks, none before it (BTN-1581)', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 75))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(77))
    expect(await databaseVersion(frozen)).toBe(77)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 77, 77)
    expect((await loadChainState(frozen)).landings).toEqual({ [PROJECT]: [{ task: 'ABC-2', rounds: 1, resolving: true }] })
    await upgraded.exec(fixture(76))
    await upgraded.exec(STEPS[74]!)
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
    expect((await loadChainState(upgraded)).landings).toEqual({})
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('a landing is saved and read back', { timeout: 120_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    const state = { ...emptyChainState(), landings: { [PROJECT]: [{ task: 'ABC-5', rounds: 2, waitingRemote: true as const, failures: 3, retryAt: '2026-11-23T10:00:00.000Z' }] } }
    await saveChainState(db, state)
    expect((await loadChainState(db)).landings).toEqual(state.landings)
  } finally {
    await db.close()
  }
})
