import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { BuiltinFiles } from '../builtin/files.js'
import { BuiltinStore } from '../builtin/store.js'
import { backupDatabase } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'
import { dataDirOf, filesDirOf } from './owner.js'

it('step 32 keeps a built-in task\'s attachments, and a task before it has none', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 30))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(32))
    expect(await databaseVersion(frozen)).toBe(32)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 32, 32)
    expect((await new BuiltinStore(frozen).files({ project: ABC, number: 1 })).map((each) => [each.name, each.size, each.sha256])).toEqual([
      ['screenshot.png', 68, 'a'.repeat(64)],
    ])
    await upgraded.exec(fixture(31))
    await upgraded.exec(STEPS[29]!)
    expect(await new BuiltinStore(upgraded).files({ project: ABC, number: 1 })).toEqual([])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('a backup carries the attachments\' bytes, and the restored copy serves them', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ek-backup-files-'))
  const source = await openDatabase(undefined)
  const sourceFiles = filesDirOf(join(dir, 'even-keel'))
  try {
    const store = new BuiltinStore(source)
    const number = await store.create({ project: ABC, title: 'With a picture' })
    const picture = await new BuiltinFiles(store, sourceFiles).add({ project: ABC, number }, {
      name: 'screen.png', type: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    })
    writeFileSync(join(sourceFiles, '.upload-half.tmp'), 'half')
    const copy = join(dir, 'backup')
    await backupDatabase(source, copy, sourceFiles)
    rmSync(sourceFiles, { recursive: true })
    const restored = await openDatabase(dataDirOf(copy))
    try {
      const files = new BuiltinFiles(new BuiltinStore(restored), filesDirOf(copy), () => {})
      const listed = await files.list({ project: ABC, number })
      expect(listed.map((each) => [each.name, each.missing])).toEqual([['screen.png', false]])
      expect(readFileSync(listed[0]!.path)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      expect(listed[0]!.sha256).toBe(picture.sha256)
      expect(await files.sweep(0)).toEqual([])
    } finally {
      await restored.close()
    }
  } finally {
    await source.close()
  }
})
