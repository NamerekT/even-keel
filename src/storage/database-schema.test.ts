import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { databaseVersion, openDatabase, STEPS } from './database.js'
import { fixture, schemaOf } from './database.fixture.js'

describe('schema steps match the frozen database samples', { timeout: 120_000 }, () => {
  it('of version 3 has the tables step 3 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 1))
    try {
      await frozen.exec(fixture(3))
      expect(await databaseVersion(frozen)).toBe(3)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 4 has the tables step 4 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 2))
    try {
      await frozen.exec(fixture(4))
      expect(await databaseVersion(frozen)).toBe(4)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 5 has the tables step 5 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 3))
    try {
      await frozen.exec(fixture(5))
      expect(await databaseVersion(frozen)).toBe(5)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 6 has the tables step 6 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 4))
    try {
      await frozen.exec(fixture(6))
      expect(await databaseVersion(frozen)).toBe(6)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 7 has the tables step 7 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 5))
    try {
      await frozen.exec(fixture(7))
      expect(await databaseVersion(frozen)).toBe(7)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 8 has the schema step 8 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 6))
    try {
      await frozen.exec(fixture(8))
      expect(await databaseVersion(frozen)).toBe(8)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 9 has the schema step 9 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 7))
    try {
      await frozen.exec(fixture(9))
      expect(await databaseVersion(frozen)).toBe(9)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 10 has the schema step 10 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 8))
    try {
      await frozen.exec(fixture(10))
      expect(await databaseVersion(frozen)).toBe(10)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 11 has the schema step 11 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 9))
    try {
      await frozen.exec(fixture(11))
      expect(await databaseVersion(frozen)).toBe(11)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 12 has the schema step 12 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 10))
    try {
      await frozen.exec(fixture(12))
      expect(await databaseVersion(frozen)).toBe(12)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 13 has the schema step 13 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 11))
    try {
      await frozen.exec(fixture(13))
      expect(await databaseVersion(frozen)).toBe(13)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 14 has the schema step 14 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 12))
    try {
      await frozen.exec(fixture(14))
      expect(await databaseVersion(frozen)).toBe(14)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('of version 15 has the schema step 15 makes', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 13))
    try {
      await frozen.exec(fixture(15))
      expect(await databaseVersion(frozen)).toBe(15)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })
})
