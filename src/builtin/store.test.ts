import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { openDatabase } from '../storage/database.js'
import { BUILTIN_STATUSES, compareBuiltinMilestones } from './model.js'
import { BuiltinStore, type TaskKey } from './store.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'
const KEYS: Record<string, string> = { [ABC]: 'ABC', [XYZ]: 'XYZ' }

let db: PGlite
let store: BuiltinStore
const abc = (number: number): TaskKey => ({ project: ABC, number })

const code = async (work: Promise<unknown>) => {
  try {
    await work
  } catch (error) {
    return error instanceof NoticeError ? error.notice : error
  }
  throw new Error('no failure')
}

beforeAll(async () => {
  db = await openDatabase(undefined)
}, 120_000)
afterAll(() => db.close())
beforeEach(async () => {
  await db.exec('truncate builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_task_labels, builtin_relations, builtin_comments')
  store = new BuiltinStore(db, ({ project, number }) => `${KEYS[project]}-${number}`)
})

describe('statuses', () => {
  it('are the fixed seven with their categories', () => {
    expect(BUILTIN_STATUSES.map((status) => `${status.name}:${status.category}`)).toEqual([
      'Backlog:UnStarted', 'Todo:ToDo', 'In Progress:Active', 'In Review:Active', 'Done:Won', 'Canceled:Lost', 'Duplicate:Lost',
    ])
  })

  it('a new task is in Todo unless named, a status is taken ignoring case and an unknown one refused', async () => {
    await store.create({ project: ABC, title: 'First' })
    await store.create({ project: ABC, title: 'Second', status: 'backlog' })
    expect((await store.list([ABC])).map((task) => task.status.name)).toEqual(['Todo', 'Backlog'])
    expect(await code(store.create({ project: ABC, title: 'Third', status: 'Later' }))).toMatchObject({ code: 'builtin.badStatus' })
  })
})

describe('numbers', () => {
  it('count per project, and past the projects that share the key', async () => {
    expect(await store.create({ project: ABC, title: 'a' })).toBe(1)
    expect(await store.create({ project: ABC, title: 'b' })).toBe(2)
    expect(await store.create({ project: XYZ, title: 'c' })).toBe(1)
    expect(await store.create({ project: XYZ, title: 'd' }, [ABC])).toBe(3)
  })

  it('are not reused after a task is deleted', async () => {
    await store.create({ project: ABC, title: 'a' })
    await store.remove(abc(1))
    expect(await store.create({ project: ABC, title: 'b' })).toBe(2)
  })
})

describe('field edits', () => {
  beforeEach(async () => {
    await store.create({ project: ABC, title: 'Parse input' })
  })

  it('another edit of another field is no conflict', async () => {
    await store.edit(abc(1), { field: 'status', from: 'Todo', to: 'In Progress' })
    const task = await store.edit(abc(1), { field: 'title', from: 'Parse input', to: 'Parse the input' })
    expect(task).toMatchObject({ title: 'Parse the input', status: { name: 'In Progress' } })
  })

  it('an edit to the value the field already holds is no conflict and changes nothing', async () => {
    const before = (await store.get(abc(1)))!
    await store.edit(abc(1), { field: 'priority', from: 'none', to: 'high' })
    const again = await store.edit(abc(1), { field: 'priority', from: 'low', to: 'high' })
    expect(again.priority).toBe('high')
    expect(again.version).toBe(before.version + 1)
  })

  it('the same field changed otherwise is a conflict with the current value', async () => {
    await store.edit(abc(1), { field: 'status', from: 'Todo', to: 'Done' })
    expect(await code(store.edit(abc(1), { field: 'status', from: 'Todo', to: 'Backlog' }))).toEqual({
      code: 'builtin.conflict',
      params: { task: 'ABC-1', field: 'status', current: 'Done' },
    })
  })

  it('a milestone is set by name, created on the fly and compared ignoring case', async () => {
    await store.edit(abc(1), { field: 'milestone', from: null, to: 'v0.3' })
    expect((await store.get(abc(1)))!.milestone).toEqual({ name: 'v0.3', date: null })
    await store.edit(abc(1), { field: 'milestone', from: 'V0.3', to: null })
    expect((await store.get(abc(1)))!.milestone).toBeNull()
    expect((await store.milestones(ABC)).map((each) => each.name)).toEqual(['v0.3'])
  })

  it('every change moves the version', async () => {
    const before = (await store.get(abc(1)))!.version
    await store.edit(abc(1), { field: 'title', from: 'Parse input', to: 'x' })
    await store.relabel(abc(1), { add: ['Bug'], remove: [] })
    await store.comment(abc(1), 'agent', 'done')
    expect((await store.get(abc(1)))!.version).toBe(before + 3)
  })
})

describe('description', () => {
  beforeEach(async () => {
    await store.create({ project: ABC, title: 'Parse input', description: 'Read the file.\n\nThen parse it.' })
  })

  it('a whole replacement from the current revision goes, from an old one is refused', async () => {
    const task = await store.setDescription(abc(1), 'New text', 0)
    expect(task).toMatchObject({ description: 'New text', descriptionRev: 1 })
    expect(await code(store.setDescription(abc(1), 'Stale', 0))).toEqual({
      code: 'builtin.descriptionConflict',
      params: { task: 'ABC-1', rev: 1 },
    })
  })

  it('a status or labels change leaves the revision alone', async () => {
    await store.edit(abc(1), { field: 'status', from: 'Todo', to: 'In Progress' })
    await store.relabel(abc(1), { add: ['Rework'], remove: [] })
    expect((await store.get(abc(1)))!.descriptionRev).toBe(0)
    expect((await store.setDescription(abc(1), 'Still mine', 0)).descriptionRev).toBe(1)
  })

  it('a patch needs no revision but its text found exactly once', async () => {
    await store.setDescription(abc(1), 'Read the file.\n\nThen parse it.\n\nThen parse it.', 0)
    expect(await code(store.patchDescription(abc(1), 'Then parse it.', 'x'))).toMatchObject({ params: { count: 2 } })
    expect(await code(store.patchDescription(abc(1), 'Missing', 'x'))).toMatchObject({ params: { count: 0 } })
    const task = await store.patchDescription(abc(1), 'Read the file.', 'Read the folder.')
    expect(task).toMatchObject({ description: 'Read the folder.\n\nThen parse it.\n\nThen parse it.', descriptionRev: 2 })
  })
})

describe('labels and links', () => {
  beforeEach(async () => {
    await store.create({ project: ABC, title: 'a', labels: ['Bug'] })
    await store.create({ project: ABC, title: 'b' })
    await store.create({ project: XYZ, title: 'c' })
  })

  it('labels are added and removed one by one, created on the fly, ignoring case', async () => {
    await store.relabel(abc(1), { add: ['Rework'], remove: [] })
    expect(await store.relabel(abc(1), { add: ['bug', 'Later'], remove: ['rework'] })).toEqual(['Bug', 'Later'])
    expect((await store.labels(ABC)).map((label) => label.name)).toEqual(['Bug', 'Later', 'Rework'])
    expect((await store.labels(ABC)).every((label) => label.color >= 0 && label.color < 24)).toBe(true)
  })

  it('a link is added alongside the others, across projects, and seen from both ends', async () => {
    await store.relate(abc(1), abc(2), 'blocks')
    await store.relate({ project: XYZ, number: 1 }, abc(2), 'blocks')
    await store.relate(abc(2), abc(1), 'relates')
    await store.relate(abc(1), abc(2), 'relates')
    const [one, two] = await store.list([ABC])
    expect(two!.blockedBy).toEqual([abc(1), { project: XYZ, number: 1 }])
    expect(one!.blocks).toEqual([abc(2)])
    expect(one!.related).toEqual([abc(2)])
    expect(two!.related).toEqual([abc(1)])
    await store.unrelate(abc(1), abc(2), 'blocks')
    expect((await store.get(abc(2)))!.blockedBy).toEqual([{ project: XYZ, number: 1 }])
  })

  it('a task is not linked to itself', async () => {
    expect(await code(store.relate(abc(1), abc(1), 'blocks'))).toMatchObject({ code: 'builtin.selfLink' })
  })
})

describe('parents', () => {
  beforeEach(async () => {
    for (const title of ['top', 'middle', 'bottom']) await store.create({ project: ABC, title })
    await store.edit(abc(2), { field: 'parent', from: null, to: 1 })
    await store.edit(abc(3), { field: 'parent', from: null, to: 2 })
  })

  it('go any depth and count their subtasks', async () => {
    expect((await store.list([ABC])).map((task) => [task.number, task.parent, task.subtasks])).toEqual([[1, null, 1], [2, 1, 1], [3, 2, 0]])
    expect((await store.children(abc(1))).map((task) => task.number)).toEqual([2])
  })

  it('a task never becomes a subtask of its own subtask', async () => {
    expect(await code(store.edit(abc(1), { field: 'parent', from: null, to: 3 }))).toEqual({
      code: 'builtin.parentCycle',
      params: { task: 'ABC-1', parent: 'ABC-3' },
    })
    expect(await code(store.edit(abc(1), { field: 'parent', from: null, to: 1 }))).toMatchObject({ code: 'builtin.parentCycle' })
  })
})

describe('milestones', () => {
  it('go by date, the undated after, then by name with numbers as numbers', async () => {
    for (const name of ['v0.10', 'v0.9', 'Later']) await store.saveMilestone(ABC, name, null)
    await store.saveMilestone(ABC, 'Spring', Date.UTC(2027, 2, 1))
    await store.saveMilestone(ABC, 'Winter', Date.UTC(2026, 11, 1))
    expect((await store.milestones(ABC)).map((each) => each.name)).toEqual(['Winter', 'Spring', 'Later', 'v0.9', 'v0.10'])
    expect([{ name: 'b', date: null }, { name: 'a', date: 5 }].sort(compareBuiltinMilestones)[0]!.name).toBe('a')
  })
})

describe('comments and deletion', () => {
  it('comments after one come in order; an unknown one gives none', async () => {
    await store.create({ project: ABC, title: 'a' })
    const first = await store.comment(abc(1), 'service', 'question')
    await store.comment(abc(1), 'person', 'answer')
    expect((await store.comments(abc(1), first)).map((each) => [each.author, each.body])).toEqual([['person', 'answer']])
    expect(await store.comments(abc(1), '999')).toEqual([])
  })

  it('a deleted task leaves no trace in links, parents or labels', async () => {
    for (const title of ['a', 'b', 'c']) await store.create({ project: ABC, title, labels: ['Bug'] })
    await store.relate(abc(1), abc(2), 'blocks')
    await store.relate(abc(3), abc(1), 'relates')
    await store.edit(abc(2), { field: 'parent', from: null, to: 1 })
    await store.comment(abc(1), 'agent', 'x')
    expect(await store.remove(abc(1))).toBe(true)
    expect(await store.remove(abc(1))).toBe(false)
    const tasks = await store.list([ABC])
    expect(tasks.map((task) => [task.number, task.parent, task.blockedBy, task.related])).toEqual([[2, null, [], []], [3, null, [], []]])
    const counts = await db.query<{ n: number }>(
      'select (select count(*) from builtin_relations)::int + (select count(*) from builtin_comments)::int + (select count(*) from builtin_task_labels)::int as n',
    )
    expect(counts.rows[0]!.n).toBe(2)
  })
})
