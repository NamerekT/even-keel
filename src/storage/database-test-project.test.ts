import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import { fileOf } from '../settings/file.js'
import { readSettings } from '../settings/store.js'
import { ABC, fixture, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 33 registers the optional project flag without changing old projects', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const upgraded = await PGlite.create()
  const made = await openDatabase(undefined)
  try {
    await frozen.exec(fixture(33))
    expect(await databaseVersion(frozen)).toBe(33)
    expect(await schemaOf(frozen)).toEqual(await schemaOf(made))
    await upgraded.exec(fixture(32))
    await upgraded.exec(STEPS.at(-1)!)
    await upgraded.exec(STEPS.at(-1)!)
    expect(parseConfig(fileOf(await readSettings(upgraded))).settings[ABC]?.testProject).toBe(false)
    expect((await upgraded.query("select default_value from setting_definitions where key = 'testProject'")).rows)
      .toEqual([{ default_value: 'false' }])
  } finally {
    await Promise.all([frozen.close(), upgraded.close(), made.close()])
  }
})
