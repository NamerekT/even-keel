import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'
import { dropLeftFolder, loadLeftFolders, saveLeftFolder } from './left-folders.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const PATH = 'C:\\repos\\example-project\\.claude\\worktrees\\abc-3'

it('step 43 adds the worktree folders a cleanup after Done left, none before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 41))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(43))
    expect(await databaseVersion(frozen)).toBe(43)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 43, 43)
    expect(await loadLeftFolders(frozen)).toEqual([
      { project: PROJECT, task: 'ABC-3', repo: 'C:\\repos\\example-project', path: PATH, until: 1794714366000 },
    ])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(42))
    await upgraded.exec(STEPS[40]!)
    expect(await loadLeftFolders(upgraded)).toEqual([])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('a folder left again replaces its row, a settled one deletes it', { timeout: 60_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    const folder = { project: PROJECT, task: 'ABC-3', repo: 'C:\\repos\\example-project', path: PATH, until: 1 }
    await saveLeftFolder(db, folder)
    await saveLeftFolder(db, { ...folder, until: 2 })
    expect(await loadLeftFolders(db)).toEqual([{ ...folder, until: 2 }])
    await dropLeftFolder(db, PATH)
    expect(await loadLeftFolders(db)).toEqual([])
  } finally {
    await db.close()
  }
})
