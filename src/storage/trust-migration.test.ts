import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { databaseVersion, openDatabase, STEPS } from './database.js'
import { fixture, schemaOf } from './database.fixture.js'

describe('automatic Claude trust database migration', () => {
  it('matches the frozen database at step 27', async () => {
    const frozen = await openDatabase(undefined, [])
    const made = await openDatabase(undefined)
    try {
      await frozen.exec(fixture(27))
      expect(await databaseVersion(frozen)).toBe(27)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await frozen.close()
      await made.close()
    }
  })

  it('drops both legacy consent values and their definition, preserving other settings after reopening', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'even-keel-trust-'))
    try {
      const old = await openDatabase(dir, STEPS.slice(0, 24))
      await old.exec(`
        insert into projects (id, key, repo, branch, tracker_projects, feeds, position)
          values ('one', 'ONE', 'D:/one', 'main', '{}', '[]', 0), ('two', 'TWO', 'D:/two', 'main', '{}', '[]', 1);
        insert into setting_definitions (key, kind, spec, scopes)
          values ('trustClaude', 'boolean', '{}', 'project'), ('brief', 'boolean', '{}', 'project');
        insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by)
          values ('trustClaude', 'one', '', 'true', '2026-01-01', 'page'),
                 ('trustClaude', 'two', '', 'false', '2026-01-01', 'page'),
                 ('brief', 'one', '', 'true', '2026-01-01', 'page');
      `)
      await old.close()
      const migrated = await openDatabase(dir)
      try {
        expect((await migrated.query("select key from setting_values order by key")).rows).toEqual([{ key: 'brief' }])
        expect((await migrated.query("select key from setting_definitions where key = 'trustClaude'")).rows).toEqual([])
        expect((await migrated.query('select id from projects order by id')).rows).toEqual([{ id: 'one' }, { id: 'two' }])
      } finally {
        await migrated.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
