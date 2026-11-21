import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const commentsOf = async (db: PGlite) =>
  (
    await db.query<{ author: string; body: string; model: string | null }>(
      `select c.author, c.body, c.model from builtin_comments c join builtin_tasks t on t.id = c.task_id where t.project_id = $1 and t.number = 1 order by c.id`,
      [ABC],
    )
  ).rows.map((row) => [row.author, row.body, row.model])

it('step 31 keeps the model of an agent\'s comment, and the comments before it have none', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 29))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(31))
    expect(await databaseVersion(frozen)).toBe(31)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 31, 31)
    // The comments as the step left them: today's store reads columns of later steps (`author_name`, step 71).
    expect(await commentsOf(frozen)).toEqual([
      ['agent', 'Done: the parser.', 'Claude | opus'],
      ['person', 'Checked by hand.', null],
    ])
    await upgraded.exec(fixture(30))
    await upgraded.exec(STEPS[28]!)
    expect((await commentsOf(upgraded)).map(([author, , model]) => [author, model])).toEqual([['agent', null]])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
