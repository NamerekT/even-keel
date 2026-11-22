import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BuiltinStore } from '../../src/builtin/store.js'
import { stepOf } from '../../src/stats/calibration.js'
import { openDatabase } from '../../src/storage/database.js'
import { builtinLeftovers, builtinTasks } from './builtin-tasks.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const ABC_RELEASE = '22222222-2222-4222-8222-222222222222'
const HULY = '33333333-3333-4333-8333-333333333333'
const SWITCHED = '44444444-4444-4444-8444-444444444444'
const SWITCHED_EARLY = '55555555-5555-4555-8555-555555555555'
const HAND_SWITCHED = '66666666-6666-4666-8666-666666666666'

let db: PGlite

beforeAll(async () => {
  db = await openDatabase(undefined)
  await db.exec(`
    insert into projects (id, key, repo, branch, position) values
      ('${ABC}', 'ABC', 'C:\\repos\\example', 'main', 0),
      ('${ABC_RELEASE}', 'ABC', 'C:\\repos\\example-release', 'release/v1', 1),
      ('${HULY}', 'XYZ', 'C:\\repos\\other', 'main', 2),
      ('${SWITCHED}', 'GHN', 'C:\\repos\\third', 'main', 3),
      ('${SWITCHED_EARLY}', 'HUN', 'C:\\repos\\fourth', 'main', 4),
      ('${HAND_SWITCHED}', 'HAN', 'C:\\repos\\fifth', 'main', 5);
    insert into setting_definitions (key, kind, spec, default_value, scopes) values ('tracker', 'enum', '{}', '"huly"', 'project')
      on conflict (key) do nothing;
    insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values
      ('tracker', '${ABC}', '', '"builtin"', '2026-11-01T00:00:00.000Z', 'person'),
      ('tracker', '${ABC_RELEASE}', '', '"builtin"', '2026-11-01T00:00:00.000Z', 'person'),
      ('tracker', '${HULY}', '', '"huly"', '2026-11-01T00:00:00.000Z', 'person'),
      ('tracker', '${SWITCHED}', '', '"github"', '2026-11-01T00:00:00.000Z', 'person'),
      ('tracker', '${SWITCHED_EARLY}', '', '"huly"', '2026-11-01T00:00:00.000Z', 'person'),
      ('tracker', '${HAND_SWITCHED}', '', '"huly"', '2026-11-01T00:00:00.000Z', 'person');`)
  const at = (iso: string) => () => new Date(iso)
  await new BuiltinStore(db).saveComponent(ABC, null, { name: 'Parser', description: '' })
  await new BuiltinStore(db, undefined, at('2026-11-02T10:00:00.000Z')).create({
    project: ABC, title: 'Parse the input', status: 'Done', priority: 'high', milestone: 'v0.3', estimate: 20, component: 'Parser',
  })
  await new BuiltinStore(db, undefined, at('2026-11-03T10:00:00.000Z')).create({ project: ABC, title: 'Redo the parser', labels: ['Rework', 'Opus'] })
  await new BuiltinStore(db, undefined, at('2026-11-04T10:00:00.000Z')).create({ project: ABC_RELEASE, title: 'Fix the release', status: 'Canceled', labels: ['Bug'] }, [ABC])
  // A project that left the built-in tracker keeps its rows; its key names the tasks of its tracker now.
  await new BuiltinStore(db).create({ project: HULY, title: 'Left behind' })
  for (const project of [SWITCHED, SWITCHED, SWITCHED_EARLY, HAND_SWITCHED]) await new BuiltinStore(db).create({ project, title: 'Closed, not copied', status: 'Done' })
  const store = new BuiltinStore(db)
  await store.relate({ project: ABC, number: 2 }, { project: ABC, number: 1 }, 'relates')
  await store.relate({ project: ABC, number: 1 }, { project: ABC_RELEASE, number: 3 }, 'relates')
  await store.relate({ project: ABC, number: 1 }, { project: HULY, number: 1 }, 'relates')
  await store.relate({ project: ABC, number: 1 }, { project: ABC, number: 2 }, 'blocks')
  await db.exec(`
    insert into tracker_transfers (id, project_id, direction, tracker, place, key, source_key, closed, history, started_at, finished_at, switched_at, plan, checked, matched) values
      ('t1', '${SWITCHED}', 'export', 'github', 'example/third', 'GHN', 'OLD', false, false, '2026-11-20T09:00:00.000Z', '2026-11-20T09:10:00.000Z', '2026-11-20T09:11:00.000Z', '{}', '{}', true),
      ('t2', '${HULY}', 'import', 'huly', 'XYZ', 'XYZ', 'XYZ', false, false, '2026-11-20T09:00:00.000Z', '2026-11-20T09:10:00.000Z', '2026-11-20T09:11:00.000Z', '{}', '{}', true);
    insert into tracker_exports (project_id, profile, place, key, started_at, finished_at, source_key) values
      ('${SWITCHED_EARLY}', 'huly-work', 'HUN', 'HUN', '2026-11-12T09:00:00.000Z', '2026-11-12T09:10:00.000Z', 'EARLY'),
      ('${HAND_SWITCHED}', 'huly-work', 'HCP', 'HCP', '2026-11-12T09:00:00.000Z', '2026-11-12T09:10:00.000Z', 'HAND'),
      ('${ABC}', 'huly-work', 'ABH', 'ABH', '2026-11-12T09:00:00.000Z', '2026-11-12T09:10:00.000Z', 'ABC');`)
}, 120_000)
afterAll(() => db.close())

describe('builtinTasks', () => {
  it('reads every task of the projects on the built-in tracker as Tally keeps a task, named by the key and number', async () => {
    expect(await builtinTasks(db)).toEqual([
      {
        task: 'ABC-1', project: ABC, title: 'Parse the input', status: 'Done', labels: [], related: ['ABC-2', 'ABC-3'], priority: 'high', estimateH: 20 / 60,
        component: 'Parser', milestone: 'v0.3', done: true, createdAt: '2026-11-02T10:00:00.000Z',
      },
      {
        task: 'ABC-2', project: ABC, title: 'Redo the parser', status: 'Todo', labels: ['Opus', 'Rework'], related: ['ABC-1'], priority: 'none', estimateH: null,
        component: null, milestone: null, done: false, createdAt: '2026-11-03T10:00:00.000Z',
      },
      {
        task: 'ABC-3', project: ABC_RELEASE, title: 'Fix the release', status: 'Canceled', labels: ['Bug'], related: ['ABC-1'], priority: 'none', estimateH: null,
        component: null, milestone: null, done: false, createdAt: '2026-11-04T10:00:00.000Z',
      },
    ])
  })

  it('gives an estimate of 20 minutes the calibration step of 20', async () => {
    const [first] = await builtinTasks(db)
    expect(stepOf(first!.estimateH)).toBe(20)
  })
})

describe('builtinLeftovers: the old ids of the rows a switch off the built-in tracker left behind (BTN-1497)', () => {
  it('names them by the key of each switch, from the transfers and, before them, from the copies that rekeyed the project', async () => {
    expect(await builtinLeftovers(db)).toEqual(['EARLY-1', 'OLD-1', 'OLD-2'])
  })

  it('reads none from a database without the transfers', async () => {
    const old = await PGlite.create()
    try {
      expect(await builtinLeftovers(old)).toEqual([])
    } finally {
      await old.close()
    }
  })
})
