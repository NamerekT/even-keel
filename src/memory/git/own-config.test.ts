import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase } from '../../storage/database.js'
import { setStateValue } from '../../storage/service-state.js'
import { OwnConfigs } from './own-config.js'

describe('the machines with their own configuration (BTN-1745)', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await openDatabase(undefined)
  }, 30_000)

  afterAll(async () => {
    await db.close()
  })

  it('keeps the switch across a load, on and off by machine', async () => {
    const own = new OwnConfigs(db)
    await own.load()
    expect(own.has('m1')).toBe(false)
    await own.set('m1', true)
    await own.set('m2', true)
    await own.set('m2', false)
    await own.set('m1', true)
    const again = new OwnConfigs(db)
    await again.load()
    expect(again.has('m1')).toBe(true)
    expect(again.has('m2')).toBe(false)
  })

  it('reads a value of another shape as no machine', async () => {
    await setStateValue(db, 'config.own', { m1: true })
    const own = new OwnConfigs(db)
    await own.load()
    expect(own.has('m1')).toBe(false)
  })
})
