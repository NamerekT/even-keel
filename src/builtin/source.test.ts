import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { openDatabase } from '../storage/database.js'
import type { TaskSource } from '../tracker/source.js'
import { builtinSource } from './source.js'
import { BuiltinStore } from './store.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const SECOND_ABC = '66666666-6666-4666-8666-666666666666'
const XYZ = '22222222-2222-4222-8222-222222222222'
const PLACES = { [ABC]: { key: 'ABC' }, [SECOND_ABC]: { key: 'ABC' }, [XYZ]: { key: 'XYZ' } }
const open = (status: { category: string }) => status.category !== 'Won' && status.category !== 'Lost'

let db: PGlite
let source: TaskSource
let store: BuiltinStore

const notice = async (work: Promise<unknown>) => {
  try {
    await work
  } catch (error) {
    return error instanceof NoticeError ? error.notice.code : error
  }
  throw new Error('no failure')
}

beforeAll(async () => {
  db = await openDatabase(undefined)
}, 120_000)
afterAll(() => db.close())
beforeEach(async () => {
  await db.exec('truncate builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_task_labels, builtin_relations, builtin_comments')
  source = builtinSource(db, PLACES)
  store = new BuiltinStore(db)
})

describe('the built-in tracker as a task source', () => {
  it('gives the open tasks and the closed ones of an open milestone, with blockers from another project', async () => {
    const first = await source.create!({ project: ABC, title: 'First', description: '', priority: 'high', milestoneOf: null })
    await store.edit({ project: ABC, number: 1 }, { field: 'milestone', from: null, to: 'v0.3' })
    await store.create({ project: ABC, title: 'Second', milestone: 'v0.3' })
    await store.create({ project: ABC, title: 'Old', status: 'Done', milestone: 'v0.2' })
    await store.create({ project: XYZ, title: 'Elsewhere' })
    await store.relate({ project: XYZ, number: 1 }, { project: ABC, number: 2 }, 'blocks')
    await source.complete(first)
    const { tasks, statuses } = await source.chainTasks(ABC, open)
    expect(tasks.map((task) => [task.id, task.status.name, task.blockedBy])).toEqual([
      ['ABC-2', 'Todo', ['XYZ-1']],
      ['ABC-1', 'Done', []],
    ])
    expect(statuses).toContain('In Review')
  })

  it('numbers a task past the other projects of its key and finds it by its id', async () => {
    expect(await source.create!({ project: ABC, title: 'One', description: '', priority: 'none', milestoneOf: null })).toBe('ABC-1')
    expect(await source.create!({ project: SECOND_ABC, title: 'Two', description: 'text', priority: 'none', milestoneOf: null })).toBe('ABC-2')
    expect(await source.brief('ABC-2')).toEqual({ title: 'Two', description: 'text' })
    expect((await source.tasks(['ABC-1', 'ABC-2', 'ABC-9'])).map((task) => task.title)).toEqual(['One', 'Two'])
    expect(await notice(source.brief('ABC-9'))).toBe('builtin.noTask')
    expect(await notice(source.create!({ project: 'unknown', title: 'x', description: '', priority: 'none', milestoneOf: null }))).toBe('builtin.noProject')
  })

  it('puts a new task into the milestone of another task', async () => {
    await store.create({ project: XYZ, title: 'Source', milestone: 'v1' })
    const id = await source.create!({ project: ABC, title: 'Follow-up', description: '', priority: 'none', milestoneOf: 'XYZ-1' })
    expect((await source.tasks([id]))[0]?.milestone?.label).toBe('v1')
    expect(await source.setMilestone!(id, 'XYZ-1')).toBe(false)
  })

  it('moves a task to Todo and back only from the statuses each takes, and completes it only once', async () => {
    await store.create({ project: ABC, title: 'Idea', status: 'Backlog' })
    expect(await source.unready!('ABC-1')).toBeNull()
    expect((await source.ready!('ABC-1'))?.name).toBe('Todo')
    expect(await source.ready!('ABC-1')).toBeNull()
    expect((await source.moveTo!('ABC-1', 'in progress'))?.name).toBe('In Progress')
    expect((await source.unready!('ABC-1'))?.name).toBe('Backlog')
    expect(await notice(source.complete('ABC-1', 'Canceled'))).toBe('tracker.completeRefused')
    expect(await source.complete('ABC-1')).toBe(true)
    expect(await source.complete('ABC-1')).toBe(false)
  })

  it('answers with what a person or an agent wrote after a comment, never its own comments', async () => {
    await store.create({ project: ABC, title: 'Asked' })
    const asked = await source.comment!('ABC-1', 'QUESTION: which one?')
    await store.comment({ project: ABC, number: 1 }, 'person', 'The second.')
    await source.comment!('ABC-1', 'Thanks.')
    await store.comment({ project: ABC, number: 1 }, 'agent', 'Taken.')
    expect((await source.commentsAfter!('ABC-1', asked)).map((each) => each.body)).toEqual(['The second.', 'Taken.'])
    const card = await source.card!('ABC-1')
    expect(card.comments.map((each) => each.author)).toEqual(['Even Keel', null, 'Even Keel', 'Agent'])
  })

  it('gives a parent its children and a milestone its tasks with their last comment', async () => {
    await store.create({ project: ABC, title: 'Parent', milestone: 'v0.3' })
    await store.create({ project: ABC, title: 'Child', parent: 1, milestone: 'v0.3' })
    await store.comment({ project: ABC, number: 2 }, 'agent', 'Done: child.')
    expect((await source.children!('ABC-1')).map((task) => [task.id, task.parent])).toEqual([['ABC-2', 'ABC-1']])
    expect((await source.milestoneTasks!(ABC, 'V0.3')).map((task) => [task.id, task.lastComment])).toEqual([
      ['ABC-1', null],
      ['ABC-2', 'Done: child.'],
    ])
    const { labels } = await source.vocabulary!(ABC)
    expect(labels).toEqual(['Manual', 'Question', 'Bug', 'Rework'])
  })
})
