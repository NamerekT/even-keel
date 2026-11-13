import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { dropRunImport, dropTaskRun, loadRunImports, loadTaskRuns, saveTaskRun } from '../sessions/runs-store.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf, SECOND_ABC, XYZ } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const STEP = STEPS[44]!

describe('step 47: the tasks’ runs (BTN-983)', { timeout: 120_000 }, () => {
  it('makes the tables of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 45))
    try {
      await frozen.exec(fixture(47))
      expect(await databaseVersion(frozen)).toBe(47)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 47, 47)
      expect(await loadTaskRuns(frozen)).toEqual([
        { project: ABC, task: 'ABC-2', provider: 'claude', model: 'opus', effort: 'high' },
        { project: ABC, task: 'ABC-3', provider: null, model: null, effort: 'low' },
      ])
      expect(await loadRunImports(frozen)).toEqual([XYZ])
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('marks the projects that read run labels and drops the setting', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(46))
      await db.exec(`
        insert into setting_definitions (key, kind, spec, default_value, scopes, qualifier, task_label) values ('modelLabels', 'boolean', '{}', 'false', 'global,project', null, null);
        insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values
          ('modelLabels', null, '', 'true', '2026-11-01T09:00:00.000Z', 'page'),
          ('modelLabels', '${XYZ}', '', 'false', '2026-11-01T09:00:00.000Z', 'page'),
          ('modelLabels', '${SECOND_ABC}', '', 'true', '2026-11-01T09:00:00.000Z', 'page');
      `)
      await db.exec(STEP)
      expect(await loadRunImports(db)).toEqual([ABC, SECOND_ABC])
      expect(await loadTaskRuns(db)).toEqual([])
      const left = await db.query("select 1 from setting_values where key = 'modelLabels' union all select 1 from setting_definitions where key = 'modelLabels'")
      expect(left.rows).toEqual([])
    } finally {
      await db.close()
    }
  })

  it('marks nothing where the labels were off', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(46))
      await db.exec(STEP)
      expect(await loadRunImports(db)).toEqual([])
    } finally {
      await db.close()
    }
  })

  it('a run saved again replaces its row, a dropped one deletes it; a moved project loses its mark', async () => {
    const db = await openDatabase(undefined)
    try {
      await saveTaskRun(db, { project: ABC, task: 'ABC-1', provider: 'codex', model: null, effort: null })
      await saveTaskRun(db, { project: ABC, task: 'ABC-1', provider: 'codex', model: 'gpt-example', effort: 'high' })
      expect(await loadTaskRuns(db)).toEqual([{ project: ABC, task: 'ABC-1', provider: 'codex', model: 'gpt-example', effort: 'high' }])
      await dropTaskRun(db, ABC, 'ABC-1')
      expect(await loadTaskRuns(db)).toEqual([])
      await db.query('insert into run_label_imports (project_id) values ($1)', [ABC])
      await dropRunImport(db, ABC)
      expect(await loadRunImports(db)).toEqual([])
    } finally {
      await db.close()
    }
  })
})
