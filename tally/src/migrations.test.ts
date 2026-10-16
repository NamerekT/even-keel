import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TALLY_SCHEMA_VERSION, tallyVersion } from '../../src/stats/tally-schema.js'
import { migrate, pgliteDb, STEPS } from './migrations.js'

const BASE = `create table if not exists notes (id integer primary key, text text not null);`
const SECOND = `alter table notes add column author text;`

describe('schema migrations', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await PGlite.create()
  }, 30_000)

  afterEach(async () => {
    await db.close()
  })

  it('takes an empty database to the latest version', async () => {
    const result = await migrate(pgliteDb(db), [BASE, SECOND])
    expect(result).toEqual({ state: 'migrated', from: 0, to: 2 })
    expect(await tallyVersion(db)).toBe(2)
    await db.query(`insert into notes (id, text, author) values (1, 'a', 'John Doe')`)
  })

  it('marks a database without the version table as version 1 and goes on from there', async () => {
    await db.exec(`create table notes (id integer primary key, text text not null); insert into notes values (1, 'kept');`)
    const result = await migrate(pgliteDb(db), [BASE, SECOND])
    expect(result).toEqual({ state: 'migrated', from: 0, to: 2 })
    expect((await db.query<{ text: string; author: string | null }>('select text, author from notes')).rows).toEqual([{ text: 'kept', author: null }])
  })

  it('does nothing on a database at the latest version', async () => {
    await migrate(pgliteDb(db), [BASE, SECOND])
    expect(await migrate(pgliteDb(db), [BASE, SECOND])).toEqual({ state: 'current', version: 2 })
  })

  it('applies only the missing steps', async () => {
    await migrate(pgliteDb(db), [BASE])
    expect(await migrate(pgliteDb(db), [BASE, SECOND])).toEqual({ state: 'migrated', from: 1, to: 2 })
  })

  it('refuses a database newer than the code without writing to it', async () => {
    await migrate(pgliteDb(db), [BASE, SECOND])
    expect(await migrate(pgliteDb(db), [BASE])).toEqual({ state: 'newer', version: 2, known: 1 })
    const columns = await db.query(`select column_name from information_schema.columns where table_name = 'notes' order by column_name`)
    expect(columns.rows).toEqual([{ column_name: 'author' }, { column_name: 'id' }, { column_name: 'text' }])
    expect(await tallyVersion(db)).toBe(2)
  })

  it('rolls a failed step back and keeps the previous version', async () => {
    await migrate(pgliteDb(db), [BASE])
    const broken = `alter table notes add column author text; select no_such_function();`
    await expect(migrate(pgliteDb(db), [BASE, broken])).rejects.toThrow(/no_such_function/)
    expect(await tallyVersion(db)).toBe(1)
    const columns = await db.query(`select column_name from information_schema.columns where table_name = 'notes' and column_name = 'author'`)
    expect(columns.rows).toEqual([])
  })

  it('rolls a failed first step back to no version at all', async () => {
    await expect(migrate(pgliteDb(db), [`create table notes (id integer); select no_such_function();`])).rejects.toThrow()
    expect(await tallyVersion(db)).toBe(0)
    expect((await db.query(`select to_regclass('notes') as found`)).rows).toEqual([{ found: null }])
  })

  it('leaves a database alone when the role does not own its tables, and names what to run', async () => {
    await migrate(pgliteDb(db), [BASE])
    await db.exec(`create role writer; grant usage on schema public to writer; grant all on notes, schema_version to writer; set role writer`)
    const result = await migrate(pgliteDb(db), [BASE, SECOND])
    expect(result).toEqual({
      state: 'denied',
      from: 1,
      to: 2,
      user: 'writer',
      fixes: [
        { role: 'postgres', sql: 'alter table notes owner to writer' },
        { role: 'postgres', sql: 'alter table schema_version owner to writer' },
        { role: 'postgres', sql: 'grant create on schema public to writer' },
      ],
    })
    await db.exec('reset role')
    expect(await tallyVersion(db)).toBe(1)
  })

  it('knows as many versions as it has steps', () => {
    expect(STEPS.length).toBe(TALLY_SCHEMA_VERSION)
  })
})
