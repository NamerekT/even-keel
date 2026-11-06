import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { BuiltinStore } from '../builtin/store.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 31 keeps the model of an agent\'s comment, and the comments before it have none', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 29))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(31))
    expect(await databaseVersion(frozen)).toBe(31)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 31, 31)
    const comments = await new BuiltinStore(frozen).comments({ project: ABC, number: 1 })
    expect(comments.map((each) => [each.author, each.body, each.model])).toEqual([
      ['agent', 'Done: the parser.', 'Claude | opus'],
      ['person', 'Checked by hand.', null],
    ])
    await upgraded.exec(fixture(30))
    await upgraded.exec(STEPS[28]!)
    expect((await new BuiltinStore(upgraded).comments({ project: ABC, number: 1 })).map((each) => [each.author, each.model])).toEqual([['agent', null]])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
