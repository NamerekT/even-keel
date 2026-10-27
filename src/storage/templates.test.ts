import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATABASE_VERSION, databaseVersion, openDatabase, STEPS } from './database.js'

describe('test database templates', { timeout: 120_000 }, () => {
  const dirs: string[] = []
  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('opens independent current databases without repeating schema steps', async () => {
    const transaction = vi.spyOn(PGlite.prototype, 'transaction')
    const first = await openDatabase(undefined)
    const second = await openDatabase(undefined)
    try {
      expect(transaction).not.toHaveBeenCalled()
      expect(await databaseVersion(first)).toBe(DATABASE_VERSION)
      await first.exec('create table only_first (value integer)')
      expect((await second.query("select to_regclass('only_first') as found")).rows).toEqual([{ found: null }])
    } finally {
      await first.close()
      await second.close()
    }
  })

  it('copies into an empty directory on disk and reopens its writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'even-keel-template-test-'))
    dirs.push(dir)
    const dataDir = join(dir, 'pgdata')
    mkdirSync(dataDir)
    const transaction = vi.spyOn(PGlite.prototype, 'transaction')
    const first = await openDatabase(dataDir)
    try {
      expect(transaction).not.toHaveBeenCalled()
      await first.exec('create table kept (value integer); insert into kept values (42)')
    } finally {
      await first.close()
    }
    const reopened = await openDatabase(dataDir)
    try {
      expect((await reopened.query('select * from kept')).rows).toEqual([{ value: 42 }])
    } finally {
      await reopened.close()
    }
  })

  it('keeps raw clusters empty and applies custom steps instead of a template', async () => {
    const raw = await PGlite.create()
    try {
      expect(await databaseVersion(raw)).toBe(0)
    } finally {
      await raw.close()
    }
    const custom = await openDatabase(undefined, [...STEPS, 'create table extra (value integer)'])
    try {
      expect(await databaseVersion(custom)).toBe(DATABASE_VERSION + 1)
      expect((await custom.query('select * from extra')).rows).toEqual([])
    } finally {
      await custom.close()
    }
  })
})
