import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../storage/database.js'
import type { TaskChange } from '../tracker/history.js'
import { BuiltinStore, type TaskKey } from './store.js'

const ABC = '11111111-1111-4111-8111-111111111111'

let db: PGlite
let store: BuiltinStore
const abc = (number: number): TaskKey => ({ project: ABC, number })
const person = () => store.as({ by: 'person', model: null })
const agent = () => store.as({ by: 'agent', model: 'Claude | opus' })
const rows = (list: TaskChange[]) => list.map((each) => [each.by, each.field, each.from, each.to])

beforeAll(async () => {
  db = await openDatabase(undefined)
}, 120_000)
afterAll(() => db.close())
beforeEach(async () => {
  await db.exec('truncate builtin_history, builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_task_labels, builtin_relations, builtin_comments, builtin_files')
  store = new BuiltinStore(db, ({ number }) => `ABC-${number}`)
})

describe('the task history (BTN-1112)', () => {
  it('records each field change with its author, the old value and the new one', async () => {
    await person().create({ project: ABC, title: 'Parser', labels: ['Bug'], milestone: 'v0.1' })
    await person().edit(abc(1), { field: 'status', from: 'Todo', to: 'in progress' })
    await agent().edit(abc(1), { field: 'title', from: 'Parser', to: ' Fast parser ' })
    await agent().edit(abc(1), { field: 'milestone', from: 'v0.1', to: 'V0.1' })
    await agent().edit(abc(1), { field: 'milestone', from: 'v0.1', to: 'v0.2' })
    await agent().edit(abc(1), { field: 'priority', from: 'none', to: 'high' })
    await agent().setEstimate(abc(1), 40)
    await agent().setEstimate(abc(1), 40)
    await store.relabel(abc(1), { add: ['bug', 'Server'], remove: ['BUG'] })
    expect(rows(await store.history(abc(1)))).toEqual([
      ['person', 'created', null, null],
      ['person', 'status', 'Todo', 'In Progress'],
      ['agent', 'title', 'Parser', 'Fast parser'],
      ['agent', 'milestone', 'v0.1', 'v0.2'],
      ['agent', 'priority', 'none', 'high'],
      ['agent', 'estimate', null, '40'],
      ['service', 'label', 'Bug', null],
      ['service', 'label', null, 'Bug'],
      ['service', 'label', null, 'Server'],
    ])
    expect((await store.history(abc(1))).map((each) => each.model)).toEqual([null, null, ...Array(4).fill('Claude | opus'), null, null, null])
  })

  it('keeps a description change as its difference, not the two texts', async () => {
    await store.create({ project: ABC, title: 'Parser', description: 'one\ntwo' })
    await agent().patchDescription(abc(1), 'two', 'three')
    await person().setDescription(abc(1), 'one\nthree\nfour', 1)
    const [, patched, replaced] = await store.history(abc(1))
    expect(patched).toMatchObject({ by: 'agent', field: 'description', from: null, to: null, diff: [{ kind: 'same', text: 'one' }, { kind: 'removed', text: 'two' }, { kind: 'added', text: 'three' }] })
    expect(replaced?.diff).toEqual([{ kind: 'same', text: 'one' }, { kind: 'same', text: 'three' }, { kind: 'added', text: 'four' }])
    const { rows: kept } = await db.query<{ before: string | null; after: string }>("select before, after from builtin_history where field = 'description'")
    expect(kept.every((row) => row.before === null && !row.after.includes('one\nthree'))).toBe(true)
  })

  it('records a link on both tasks, each under its own side, and a parent on the task and both parents', async () => {
    for (const title of ['A', 'B', 'C']) await store.create({ project: ABC, title })
    await person().relate(abc(1), abc(2), 'blocks')
    await person().relate(abc(1), abc(2), 'blocks')
    await person().relate(abc(3), abc(1), 'relates')
    await person().unrelate(abc(1), abc(2), 'blocks')
    await person().edit(abc(3), { field: 'parent', from: null, to: 1 })
    await person().edit(abc(3), { field: 'parent', from: 1, to: 2 })
    expect(rows(await store.history(abc(1))).slice(1)).toEqual([
      ['person', 'blocks', null, 'ABC-2'],
      ['person', 'relates', null, 'ABC-3'],
      ['person', 'blocks', 'ABC-2', null],
      ['person', 'subtask', null, 'ABC-3'],
      ['person', 'subtask', 'ABC-3', null],
    ])
    expect(rows(await store.history(abc(2))).slice(1)).toEqual([
      ['person', 'blockedBy', null, 'ABC-1'],
      ['person', 'blockedBy', 'ABC-1', null],
      ['person', 'subtask', null, 'ABC-3'],
    ])
    expect(rows(await store.history(abc(3))).slice(1)).toEqual([
      ['person', 'relates', null, 'ABC-1'],
      ['person', 'parent', null, 'ABC-1'],
      ['person', 'parent', 'ABC-1', 'ABC-2'],
    ])
  })

  it('a new task records only its creation, its parent records the subtask', async () => {
    await store.create({ project: ABC, title: 'Parent' })
    await agent().create({ project: ABC, title: 'Child', parent: 1, labels: ['Bug'], milestone: 'v0.1', estimate: 10 })
    expect(rows(await store.history(abc(2)))).toEqual([['agent', 'created', null, null]])
    expect(rows(await store.history(abc(1)))).toEqual([['service', 'created', null, null], ['agent', 'subtask', null, 'ABC-2']])
  })

  it('records a run change, and a deleted task leaves the lost link in the others and nothing of its own', async () => {
    for (const title of ['A', 'B', 'C']) await store.create({ project: ABC, title })
    await store.relate(abc(1), abc(2), 'blocks')
    await store.edit(abc(3), { field: 'parent', from: null, to: 2 })
    await agent().noteRun(abc(2), null, { provider: 'claude', model: 'opus', effort: null })
    expect((await store.history(abc(2))).at(-1)).toMatchObject({ field: 'run', from: null, to: '{"provider":"claude","model":"opus","effort":null}' })
    await person().remove(abc(2))
    expect(rows(await store.history(abc(1))).at(-1)).toEqual(['person', 'blocks', 'ABC-2', null])
    expect(rows(await store.history(abc(3))).at(-1)).toEqual(['person', 'parent', 'ABC-2', null])
    const { rows: left } = await db.query<{ count: number }>("select count(*)::int as count from builtin_history h join builtin_tasks t on t.id = h.task_id where t.number = 2")
    expect(left[0]!.count).toBe(0)
  })

  it('records a milestone made and its date changed, and forgets all with the project', async () => {
    await person().create({ project: ABC, title: 'A', milestone: 'v0.1' })
    const id = await person().saveMilestone(ABC, 'v0.1', 1_795_000_000_000)
    await person().saveMilestone(ABC, 'v0.1', 1_795_000_000_000)
    expect((await store.milestoneHistory(id)).map((each) => [each.by, each.field, each.from, each.to])).toEqual([
      ['person', 'created', null, 'v0.1'],
      ['person', 'date', null, '1795000000000'],
    ])
    await store.forget(ABC)
    const { rows: left } = await db.query<{ count: number }>('select count(*)::int as count from builtin_history')
    expect(left[0]!.count).toBe(0)
  })
})
