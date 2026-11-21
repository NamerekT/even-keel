import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { readWarmPings, saveWarmPing } from '../sessions/warm-pings.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

it('step 70 keeps the keep-warm pings with their machine and tokens', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 68))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(70))
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 70, 70)
    const pings = await readWarmPings(frozen)
    expect(pings.map((ping) => [ping.machine, ping.task, ping.project, ping.cacheRead])).toEqual([
      ['machine-own-0001', 'ABC-2', ABC, 81_000],
      ['machine-laptop-0001', 'XYZ-7', null, 52_000],
    ])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(69))
    await upgraded.exec(STEPS[67]!)
    expect(await readWarmPings(upgraded)).toEqual([])
    const ping = { ...pings[0]!, at: '2026-11-12T10:08:00.000Z' }
    await saveWarmPing(upgraded, ping.machine, ping)
    await saveWarmPing(upgraded, ping.machine, ping)
    expect(await readWarmPings(upgraded)).toEqual([ping])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
