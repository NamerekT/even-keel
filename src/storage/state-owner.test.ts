import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closedTasks, saveClosedTask } from '../chain/store.js'
import { backupDatabase } from './copy.js'
import { DATABASE_VERSION, databaseVersion, STEPS } from './database.js'
import { databaseDirOf, dataDirOf, openStateDatabase, readOwner, readStateDatabase, writeOwner, type StateDatabase } from './owner.js'
import { prepareDatabase } from './state-files.js'

describe('state database ownership and backup on disk', { timeout: 120_000 }, () => {
  let dir: string
  let stateDir: string
  let logs: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-db-'))
    stateDir = join(dir, 'state')
    mkdirSync(stateDir)
    logs = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const dbDir = () => databaseDirOf(stateDir)
  const prepare = () => prepareDatabase({ stateDir, log: (line) => logs.push(line) })
  const opened = async <T>(read: (db: PGlite) => Promise<T>, database?: Promise<StateDatabase>): Promise<T> => {
    const { db, close } = await (database ?? prepare())
    try {
      return await read(db)
    } finally {
      await close()
    }
  }

  it('copies the database through its owner while it is open, closed tasks included', async () => {
    const owner = await prepare()
    const copy = join(dir, 'backup')
    try {
      await saveClosedTask(owner.db, { project: 'id-abc', task: 'ABC-1', tracker: 'huly', title: 'Done', url: null, closedAt: 't', profile: null, status: null })
      const reader = (await readStateDatabase(stateDir))!
      try {
        expect(reader.db).not.toBeInstanceOf(PGlite)
        await backupDatabase(reader.db, copy)
        await expect(backupDatabase(reader.db, copy)).rejects.toThrow(/exists/)
      } finally {
        await reader.close()
      }
    } finally {
      await owner.close()
    }
    await opened(async (db) => expect((await closedTasks(db)).map((task) => task.task)).toEqual(['ABC-1']), openStateDatabase(copy))
  })

  it('is opened by a reader when no one owns it, and served to the next reader meanwhile', async () => {
    expect(await readStateDatabase(stateDir)).toBeUndefined()
    await (await prepare()).close()
    const first = (await readStateDatabase(stateDir))!
    try {
      expect(first.db).toBeInstanceOf(PGlite)
      expect((await readOwner(dbDir()))?.pid).toBe(process.pid)
      await expect(openStateDatabase(dbDir())).rejects.toThrow(/holds the database/)
      const second = (await readStateDatabase(stateDir))!
      expect(second.db).not.toBeInstanceOf(PGlite)
      expect(await databaseVersion(second.db)).toBe(DATABASE_VERSION)
      await second.close()
    } finally {
      await first.close()
    }
    expect(await readOwner(dbDir())).toBeNull()
  })

  it('takes no notice of an owner left behind by a process that is gone', async () => {
    await (await prepare()).close()
    writeOwner(dbDir(), { pid: process.pid, port: 1 })
    expect(await readOwner(dbDir())).toBeNull()
    await opened(async (db) => expect(await databaseVersion(db)).toBe(DATABASE_VERSION))
  })

  it('is owned by one of two opens started together, the other refused', async () => {
    await (await prepare()).close()
    const [first, second] = await Promise.allSettled([openStateDatabase(dbDir()), openStateDatabase(dbDir())])
    const owners = [first, second].filter((result) => result.status === 'fulfilled')
    try {
      expect(owners).toHaveLength(1)
      expect([first, second].find((result) => result.status === 'rejected')?.reason).toMatchObject({ message: expect.stringMatching(/holds the database/) })
    } finally {
      for (const owner of owners) await owner.value.close()
    }
    expect(existsSync(join(dbDir(), 'owner.json'))).toBe(false)
  })

  it('makes a reader started with the owner wait for its port and connect to it', async () => {
    await (await prepare()).close()
    const [owner, reader] = await Promise.all([openStateDatabase(dbDir()), readStateDatabase(stateDir)])
    try {
      expect(reader!.db).not.toBeInstanceOf(PGlite)
      expect(await databaseVersion(reader!.db)).toBe(DATABASE_VERSION)
    } finally {
      await reader!.close()
      await owner.close()
    }
  })

  it('takes over a claim left by a process that died while opening', async () => {
    await (await prepare()).close()
    writeFileSync(join(dbDir(), 'owner.json'), JSON.stringify({ pid: process.pid, since: 0 }))
    await opened(async (db) => expect(await databaseVersion(db)).toBe(DATABASE_VERSION), openStateDatabase(dbDir()))
  })

  it('gives the claim back when the open fails', async () => {
    await (await prepare()).close()
    await expect(openStateDatabase(dbDir(), [...STEPS, 'not sql'])).rejects.toThrow()
    expect(existsSync(join(dbDir(), 'owner.json'))).toBe(false)
  })
})
