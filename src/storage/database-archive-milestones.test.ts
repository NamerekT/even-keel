import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { closedTasks, saveClosedTask } from '../chain/store.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 85 keeps the milestone, priority and labels of an archived task, none for rows before it (BTN-1588)', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 83))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(85))
    expect(await databaseVersion(frozen)).toBe(85)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 85, 85)
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(84))
    await upgraded.exec(STEPS[82]!)
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
    expect((await closedTasks(upgraded)).map((each) => [each.task, each.milestone, each.priority, each.labels])).toEqual([
      ['ABC-1', null, null, null],
      ['ABCGH-4', null, null, null],
    ])
    const milestone = { label: 'v0.4', targetDate: null, trackerOrder: { source: 'builtin', value: 2 } }
    const [first] = await closedTasks(upgraded)
    await saveClosedTask(upgraded, { ...first!, milestone, priority: 'high', labels: ['Bug', 'UI'] })
    expect((await closedTasks(upgraded))[0]).toMatchObject({ task: 'ABC-1', milestone, priority: 'high', labels: ['Bug', 'UI'] })
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
