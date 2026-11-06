import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { BuiltinStore } from '../builtin/store.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 30 keeps the built-in tracker\'s tasks, labels, milestones, links and comments, nothing before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 28))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(30))
    expect(await databaseVersion(frozen)).toBe(30)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 30, 30)
    const store = new BuiltinStore(frozen)
    const [first, second] = await store.list([ABC])
    expect(first).toMatchObject({
      number: 1, title: 'Parse the example input', descriptionRev: 2, status: { name: 'Done', category: 'Won' },
      priority: 'high', milestone: { name: 'v0.3', date: 1795000000000 }, parent: null, subtasks: 1, version: 5,
      blocks: [{ project: ABC, number: 2 }],
    })
    expect(second).toMatchObject({ number: 2, parent: 1, labels: ['Bug'], blockedBy: [{ project: ABC, number: 1 }] })
    // The store reads the model step 31 added: the comments of step 30 are read by hand.
    expect((await frozen.query('select author, body from builtin_comments order by id')).rows).toEqual([{ author: 'agent', body: 'Done: the parser.' }])
    await upgraded.exec(fixture(29))
    await upgraded.exec(STEPS[27]!)
    expect(await new BuiltinStore(upgraded).list([ABC])).toEqual([])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
