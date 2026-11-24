import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase } from '../../storage/database.js'
import { setStateValue } from '../../storage/service-state.js'
import { MemoryFolders } from './folders.js'

describe('the folders bound to project memory (BTN-1648)', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await openDatabase(undefined)
  }, 30_000)

  afterAll(async () => {
    await db.close()
  })

  it('keeps the bindings across a load, drops a machine left with none, and allows only its bound projects', async () => {
    const folders = new MemoryFolders(db)
    await folders.load()
    await folders.set('m1', [{ project: 'p1', folder: '/hand/p1' }])
    await folders.set('m2', [{ project: 'p2', folder: '/hand/p2' }])
    await folders.set('m2', [])
    const again = new MemoryFolders(db)
    await again.load()
    expect(again.of('m1')).toEqual([{ project: 'p1', folder: '/hand/p1' }])
    expect(again.of('m2')).toEqual([])
    expect(again.allows('m1', 'p1')).toBe(true)
    expect(again.allows('m1', 'p2')).toBe(false)
  })

  it('reads a value of another shape as no bindings', async () => {
    await setStateValue(db, 'memory.folders', { m1: [{ project: 1 }] })
    const folders = new MemoryFolders(db)
    await folders.load()
    expect(folders.of('m1')).toEqual([])
  })
})
