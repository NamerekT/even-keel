import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { BuiltinFiles } from '../builtin/files.js'
import { BuiltinStore } from '../builtin/store.js'
import { BackupError, CHECK_FILE, checkCopy, lastChecked, makeCopy, ownCopies, ownName, rotate, type CopyCheck } from './backup.js'
import { rowsOf, rowsTextOf } from './copy.js'
import { ABC } from './database.fixture.js'
import { DATABASE_VERSION, databaseVersion, openDatabase, SQLITE_VERSIONS, STEPS } from './database.js'
import { memoryDatabase } from './memory.js'
import { dataDirOf, filesDirOf } from './owner.js'

const folder = (name: string) => mkdtempSync(join(tmpdir(), `ek-${name}-`))

/** A database with one built-in task and its attachment, the bytes in `files`. */
async function withAttachment(files: string) {
  const db = await memoryDatabase()
  const store = new BuiltinStore(db)
  const number = await store.create({ project: ABC, title: 'With a picture' })
  await new BuiltinFiles(store, files).add({ project: ABC, number }, { name: 'screen.png', type: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) })
  return db
}

describe('the rows as text', () => {
  it('are the rows of rowsOf', { timeout: 120_000 }, async () => {
    const files = join(folder('rows-text'), 'files')
    const db = await withAttachment(files)
    expect(JSON.parse(await rowsTextOf(db))).toEqual(await rowsOf(db))
  })
})

describe('an automatic copy', () => {
  it('is written, opened back in a temporary folder, checked and marked; the folder of the trial goes', { timeout: 120_000 }, async () => {
    const root = folder('backup')
    const files = join(root, 'files')
    const db = await withAttachment(files)
    writeFileSync(join(files, '.upload-half.tmp'), 'half')
    const dir = join(root, 'copy')
    const temp = join(root, 'trial')
    const check = await makeCopy({ rows: await rowsTextOf(db), version: DATABASE_VERSION, dir, files, temp })
    expect(check.version).toBe(DATABASE_VERSION)
    expect(check.files).toBe(1)
    expect(check.tables.builtin_tasks).toBe(1)
    expect(check.tables.builtin_files).toBe(1)
    expect(JSON.parse(readFileSync(join(dir, CHECK_FILE), 'utf8'))).toEqual(check)
    expect(existsSync(temp)).toBe(false)
    expect(readdirSync(filesDirOf(dir))).toHaveLength(1)
    const restored = await openDatabase(dataDirOf(dir))
    try {
      expect(await new BuiltinStore(restored).files({ project: ABC, number: 1 })).toHaveLength(1)
    } finally {
      await restored.close()
    }
  })

  it('of a database before newer steps is made at its own schema version', { timeout: 120_000 }, async () => {
    const root = folder('backup-old')
    const db = await openDatabase(undefined, STEPS.slice(0, 40))
    try {
      const version = await databaseVersion(db)
      expect(version).toBe(SQLITE_VERSIONS + 40)
      const dir = join(root, 'copy')
      const check = await makeCopy({ rows: await rowsTextOf(db), version, dir })
      expect(check.version).toBe(version)
      const opened = await PGlite.create({ dataDir: dataDirOf(dir) })
      try {
        expect(await databaseVersion(opened)).toBe(version)
      } finally {
        await opened.close()
      }
    } finally {
      await db.close()
    }
  })

  it('that cannot be written is removed and fails as a copy', { timeout: 120_000 }, async () => {
    const root = folder('backup-bad')
    const dir = join(root, 'copy')
    const failed = await makeCopy({ rows: JSON.stringify({ no_such_table: [{ id: 1 }] }), version: DATABASE_VERSION, dir }).catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(BackupError)
    expect((failed as BackupError).stage).toBe('copy')
    expect(existsSync(dir)).toBe(false)
  })

  it('whose attachment has no file fails its check and is removed', { timeout: 120_000 }, async () => {
    const root = folder('backup-nofile')
    const db = await withAttachment(join(root, 'files'))
    const dir = join(root, 'copy')
    const failed = await makeCopy({ rows: await rowsTextOf(db), version: DATABASE_VERSION, dir, files: join(root, 'elsewhere') }).catch((error: unknown) => error)
    expect((failed as BackupError).stage).toBe('check')
    expect((failed as BackupError).message).toMatch(/is missing/)
    expect(existsSync(dir)).toBe(false)
  })
})

describe('the check of a copy', () => {
  it('refuses other rows, another version and changed bytes', { timeout: 120_000 }, async () => {
    const root = folder('backup-check')
    const files = join(root, 'files')
    const db = await withAttachment(files)
    const dir = join(root, 'copy')
    const { tables } = await makeCopy({ rows: await rowsTextOf(db), version: DATABASE_VERSION, dir, files })
    await expect(checkCopy(dir, DATABASE_VERSION, { ...tables, builtin_tasks: 2 })).rejects.toThrow(/builtin_tasks has 1 of 2/)
    await expect(checkCopy(dir, DATABASE_VERSION, { ...tables, gone_table: 0 })).rejects.toThrow(/gone_table has no table of 0/)
    await expect(checkCopy(dir, DATABASE_VERSION - 1, tables)).rejects.toThrow(/not \d+/)
    const [file] = readdirSync(filesDirOf(dir))
    writeFileSync(join(filesDirOf(dir), file!), 'other bytes')
    await expect(checkCopy(dir, DATABASE_VERSION, tables)).rejects.toThrow(/other bytes/)
  })
})

describe('the rotation', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 13, 10, minute, 0))
  const copy = (dir: string, minute: number, checked = true) => {
    const path = join(dir, ownName(at(minute), 52))
    mkdirSync(path, { recursive: true })
    if (checked) writeFileSync(join(path, CHECK_FILE), JSON.stringify({ at: at(minute).toISOString(), version: 52, tables: {}, files: 0 } satisfies CopyCheck))
    return path
  }

  it('names a copy by its time and schema', () => {
    expect(ownName(new Date(Date.UTC(2026, 10, 3, 4, 5, 6)), 52)).toBe('even-keel-auto-20261103-040506-v52')
  })

  it('keeps the newest checked copies, removes unchecked older ones and leaves copies of other names', () => {
    const dir = folder('rotate')
    for (const minute of [1, 2, 3, 4]) copy(dir, minute)
    copy(dir, 0, false)
    copy(dir, 5, false)
    mkdirSync(join(dir, 'by-hand'))
    mkdirSync(join(dir, 'even-keel-auto-manual'))
    expect(rotate(dir, 2)).toEqual([ownName(at(0), 52), ownName(at(1), 52), ownName(at(2), 52)])
    expect(readdirSync(dir).sort()).toEqual(['by-hand', 'even-keel-auto-manual', ownName(at(3), 52), ownName(at(4), 52), ownName(at(5), 52)].sort())
    expect(lastChecked(dir)?.name).toBe(ownName(at(4), 52))
  })

  it('removes nothing while no copy is checked', () => {
    const dir = folder('rotate-none')
    copy(dir, 1, false)
    copy(dir, 2, false)
    expect(rotate(dir, 1)).toEqual([])
    expect(ownCopies(dir)).toHaveLength(2)
    expect(lastChecked(dir)).toBeNull()
    expect(lastChecked(join(dir, 'missing'))).toBeNull()
  })
})
