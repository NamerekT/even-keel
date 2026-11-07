import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { BuiltinStore } from '../../src/builtin/store.js'
import { openDatabase } from '../../src/storage/database.js'
import { builtinTasks } from './builtin-tasks.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const ABC_RELEASE = '22222222-2222-4222-8222-222222222222'
const HULY = '33333333-3333-4333-8333-333333333333'

let db: PGlite

beforeAll(async () => {
  db = await openDatabase(undefined)
  await db.exec(`
    insert into projects (id, key, repo, branch, position) values
      ('${ABC}', 'ABC', 'C:\\repos\\example', 'main', 0),
      ('${ABC_RELEASE}', 'ABC', 'C:\\repos\\example-release', 'release/v1', 1),
      ('${HULY}', 'XYZ', 'C:\\repos\\other', 'main', 2);
    insert into setting_definitions (key, kind, spec, default_value, scopes) values ('tracker', 'enum', '{}', '"huly"', 'project')
      on conflict (key) do nothing;
    insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values
      ('tracker', '${ABC}', '', '"builtin"', '2026-11-01T00:00:00.000Z', 'person'),
      ('tracker', '${ABC_RELEASE}', '', '"builtin"', '2026-11-01T00:00:00.000Z', 'person'),
      ('tracker', '${HULY}', '', '"huly"', '2026-11-01T00:00:00.000Z', 'person');`)
  const at = (iso: string) => () => new Date(iso)
  await new BuiltinStore(db, undefined, at('2026-11-02T10:00:00.000Z')).create({ project: ABC, title: 'Parse the input', status: 'Done', priority: 'high', milestone: 'v0.3' })
  await new BuiltinStore(db, undefined, at('2026-11-03T10:00:00.000Z')).create({ project: ABC, title: 'Redo the parser', labels: ['Rework', 'Opus'] })
  await new BuiltinStore(db, undefined, at('2026-11-04T10:00:00.000Z')).create({ project: ABC_RELEASE, title: 'Fix the release', status: 'Canceled', labels: ['Bug'] }, [ABC])
  // A project that left the built-in tracker keeps its rows; its key names the tasks of its tracker now.
  await new BuiltinStore(db).create({ project: HULY, title: 'Left behind' })
  const store = new BuiltinStore(db)
  await store.relate({ project: ABC, number: 2 }, { project: ABC, number: 1 }, 'relates')
  await store.relate({ project: ABC, number: 1 }, { project: ABC_RELEASE, number: 3 }, 'relates')
  await store.relate({ project: ABC, number: 1 }, { project: HULY, number: 1 }, 'relates')
  await store.relate({ project: ABC, number: 1 }, { project: ABC, number: 2 }, 'blocks')
}, 120_000)
afterAll(() => db.close())

it('reads every task of the projects on the built-in tracker as Tally keeps a task, named by the key and number', async () => {
  expect(await builtinTasks(db)).toEqual([
    {
      task: 'ABC-1', title: 'Parse the input', status: 'Done', labels: [], related: ['ABC-2', 'ABC-3'], priority: 'high', estimateH: null,
      component: null, milestone: 'v0.3', done: true, createdAt: '2026-11-02T10:00:00.000Z',
    },
    {
      task: 'ABC-2', title: 'Redo the parser', status: 'Todo', labels: ['Opus', 'Rework'], related: ['ABC-1'], priority: 'none', estimateH: null,
      component: null, milestone: null, done: false, createdAt: '2026-11-03T10:00:00.000Z',
    },
    {
      task: 'ABC-3', title: 'Fix the release', status: 'Canceled', labels: ['Bug'], related: ['ABC-1'], priority: 'none', estimateH: null,
      component: null, milestone: null, done: false, createdAt: '2026-11-04T10:00:00.000Z',
    },
  ])
})
