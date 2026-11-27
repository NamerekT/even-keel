import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { readTranslationSpend } from '../badge/translate.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 45 adds the badge translation cache and spend ledger and matches its frozen sample', async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 43))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(45))
    expect(await databaseVersion(frozen)).toBe(45)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 45, 45)
    expect((await frozen.query('select title_en from badge_translations')).rows).toEqual([{ title_en: 'Fix the panel' }])
    expect(await readTranslationSpend(frozen)).toHaveLength(1)
    await upgraded.exec(fixture(44))
    expect(await readTranslationSpend(upgraded)).toEqual([])
    await upgraded.exec(STEPS[42]!)
    expect((await upgraded.query('select * from badge_translations')).rows).toEqual([])
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
}, 120_000)

it("step 89 adds the translation's prompt version, matches its frozen sample and leaves older rows on the first prompt", async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 87))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(89))
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 89, 89)
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    expect((await frozen.query('select task, prompt from badge_translations order by task')).rows)
      .toEqual([{ task: 'ABC-2', prompt: 2 }, { task: 'ABC-3', prompt: null }])
    await upgraded.exec(fixture(88))
    await upgraded.exec(STEPS[86]!)
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
    expect((await upgraded.query('select title_en, prompt from badge_translations')).rows).toEqual([{ title_en: 'Fix the panel', prompt: null }])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
}, 120_000)
