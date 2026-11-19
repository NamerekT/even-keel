import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { openDatabase } from '../storage/database.js'
import type { MilestoneFields } from './milestones.js'
import { BuiltinStore, type TaskKey } from './store.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'

let db: PGlite
let store: BuiltinStore
let clock = new Date('2026-11-19T10:00:00.000Z')
const abc = (number: number): TaskKey => ({ project: ABC, number })
const person = () => store.as({ by: 'person', model: null })
const codeOf = async (work: Promise<unknown>) => noticeOf(await work.then(() => null, (error: unknown) => error)).code
const fields = (name: string, more: Partial<MilestoneFields> = {}): MilestoneFields => ({ name, description: '', status: 'planned', date: null, ...more })

beforeAll(async () => {
  db = await openDatabase(undefined)
}, 120_000)
afterAll(() => db.close())
beforeEach(async () => {
  await db.exec(
    'truncate builtin_history, builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_components, builtin_task_labels, builtin_relations, builtin_comments, builtin_files',
  )
  clock = new Date('2026-11-19T10:00:00.000Z')
  store = new BuiltinStore(db, ({ number }) => `ABC-${number}`, () => clock)
})

describe('the milestones of the built-in tracker edited on the page (BTN-1287)', () => {
  it('lists every milestone of the project, an empty one too, with its fields and task counts', async () => {
    const beta = await person().editMilestone(ABC, null, fields(' Beta ', { description: 'First users', status: 'active', date: Date.UTC(2026, 11, 1) }))
    await store.create({ project: ABC, title: 'One', milestone: 'beta' })
    await store.create({ project: ABC, title: 'Two', milestone: 'Beta', status: 'Done' })
    await store.create({ project: ABC, title: 'Three', milestone: 'Later' })
    await store.editMilestone(XYZ, null, fields('Other'))
    expect(await store.milestoneList(ABC)).toEqual([
      {
        id: beta, name: 'Beta', date: Date.UTC(2026, 11, 1), description: 'First users', status: 'active', closedAt: null,
        createdAt: '2026-11-19T10:00:00.000Z', open: 1, total: 2, openTasks: [1],
      },
      { id: expect.any(String), name: 'Later', date: null, description: '', status: 'planned', closedAt: null, createdAt: '2026-11-19T10:00:00.000Z', open: 1, total: 1, openTasks: [3] },
    ])
  })

  it('refuses a blank name, a name the project has already ignoring case, and a milestone of another project', async () => {
    const beta = await store.editMilestone(ABC, null, fields('Beta'))
    await store.editMilestone(ABC, null, fields('GA'))
    expect(await codeOf(store.editMilestone(ABC, null, fields('  ')))).toBe('builtin.emptyName')
    expect(await codeOf(store.editMilestone(ABC, null, fields('beta')))).toBe('builtin.milestoneTaken')
    expect(await codeOf(store.editMilestone(ABC, beta, fields('ga')))).toBe('builtin.milestoneTaken')
    expect(await codeOf(store.editMilestone(XYZ, beta, fields('RC')))).toBe('builtin.noMilestone')
    await store.editMilestone(ABC, beta, fields('BETA'))
    expect((await store.milestoneList(ABC)).map((each) => each.name)).toEqual(['BETA', 'GA'])
  })

  it('sets the closing time on completed or canceled, keeps it between the two and clears it on reopening', async () => {
    const id = await store.editMilestone(ABC, null, fields('Beta'))
    const closedAt = async () => (await store.milestoneList(ABC))[0]!.closedAt
    clock = new Date('2026-11-20T10:00:00.000Z')
    await store.editMilestone(ABC, id, fields('Beta', { status: 'completed' }))
    expect(await closedAt()).toBe('2026-11-20T10:00:00.000Z')
    clock = new Date('2026-11-21T10:00:00.000Z')
    await store.editMilestone(ABC, id, fields('Beta', { status: 'canceled' }))
    expect(await closedAt()).toBe('2026-11-20T10:00:00.000Z')
    await store.editMilestone(ABC, id, fields('Beta', { status: 'active' }))
    expect(await closedAt()).toBeNull()
  })

  it('renames a milestone: its tasks carry the new name, the callback gets both names inside the write', async () => {
    const id = await store.editMilestone(ABC, null, fields('Beta'))
    await store.create({ project: ABC, title: 'One', milestone: 'Beta' })
    const renames: [string, string | null][] = []
    await store.editMilestone(ABC, id, fields('RC', { description: 'Release\ncandidate' }), (from, to) => renames.push([from, to]))
    expect(renames).toEqual([['Beta', 'RC']])
    expect((await store.get(abc(1)))?.milestone?.name).toBe('RC')
    await store.editMilestone(ABC, id, fields('RC', { description: 'Release\ncandidate' }), (from, to) => renames.push([from, to]))
    expect(renames).toHaveLength(1)
  })

  it('leaves the milestone as it was when the callback refuses the rename', async () => {
    const id = await store.editMilestone(ABC, null, fields('Beta'))
    const refused = store.editMilestone(ABC, id, fields('RC'), () => {
      throw new Error('the config refused')
    })
    await expect(refused).rejects.toThrow('the config refused')
    expect((await store.milestoneList(ABC)).map((each) => each.name)).toEqual(['Beta'])
  })

  it('records every change of the milestone in its history', async () => {
    const id = await person().editMilestone(ABC, null, fields('Beta', { date: 5 }))
    await person().editMilestone(ABC, id, fields('RC', { description: 'Text', status: 'completed', date: 6 }))
    expect((await store.milestoneHistory(id)).map((each) => [each.field, each.from, each.to])).toEqual([
      ['created', null, 'Beta'],
      ['date', null, '5'],
      ['name', 'Beta', 'RC'],
      ['description', null, JSON.stringify([{ kind: 'added', text: 'Text' }])],
      ['status', 'planned', 'completed'],
      ['date', '5', '6'],
    ])
  })

  it('deletes a milestone, its open tasks going to another milestone or to none', async () => {
    const beta = await store.editMilestone(ABC, null, fields('Beta'))
    const ga = await store.editMilestone(ABC, null, fields('GA'))
    await store.create({ project: ABC, title: 'One', milestone: 'Beta' })
    await store.create({ project: ABC, title: 'Two', milestone: 'Beta' })
    const removed: [string, string | null][] = []
    await person().removeMilestone(ABC, beta, ga, (from, to) => removed.push([from, to]))
    expect(removed).toEqual([['Beta', null]])
    expect((await store.get(abc(1)))?.milestone?.name).toBe('GA')
    expect((await store.history(abc(1))).at(-1)).toMatchObject({ field: 'milestone', from: 'Beta', to: 'GA' })
    expect((await store.milestoneHistory(beta)).at(-1)).toMatchObject({ field: 'removed', from: 'Beta', to: null })
    await store.removeMilestone(ABC, ga, null)
    expect((await store.get(abc(2)))?.milestone).toBeNull()
    expect(await store.milestoneList(ABC)).toEqual([])
  })

  it('refuses to delete a milestone with closed tasks, or to move its tasks to itself or to one not there', async () => {
    const beta = await store.editMilestone(ABC, null, fields('Beta'))
    const ga = await store.editMilestone(ABC, null, fields('GA'))
    await store.create({ project: ABC, title: 'One', milestone: 'GA', status: 'Done' })
    expect(noticeOf(await store.removeMilestone(ABC, ga, null).catch((error: unknown) => error)).params).toEqual({ milestone: 'GA', count: 1 })
    expect(await codeOf(store.removeMilestone(ABC, beta, beta))).toBe('builtin.noMilestone')
    expect(await codeOf(store.removeMilestone(ABC, beta, 'missing'))).toBe('builtin.noMilestone')
    expect(await codeOf(store.removeMilestone(XYZ, beta, null))).toBe('builtin.noMilestone')
    expect((await store.milestoneList(ABC)).map((each) => each.name)).toEqual(['Beta', 'GA'])
  })

  it('stamps a milestone made by a task’s edit with its creation time and the planned status', async () => {
    await store.create({ project: ABC, title: 'One', milestone: 'Beta' })
    expect((await store.milestoneList(ABC))[0]).toMatchObject({ name: 'Beta', status: 'planned', createdAt: '2026-11-19T10:00:00.000Z' })
  })
})
