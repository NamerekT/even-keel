import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { openDatabase } from '../storage/database.js'
import { BuiltinStore, type TaskKey } from './store.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'

let db: PGlite
let store: BuiltinStore
const abc = (number: number): TaskKey => ({ project: ABC, number })
const person = () => store.as({ by: 'person', model: null })
const codeOf = async (work: Promise<unknown>) => noticeOf(await work.then(() => null, (error: unknown) => error)).code

beforeAll(async () => {
  db = await openDatabase(undefined)
}, 120_000)
afterAll(() => db.close())
beforeEach(async () => {
  await db.exec(
    'truncate builtin_history, builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_components, builtin_task_labels, builtin_relations, builtin_comments, builtin_files',
  )
  store = new BuiltinStore(db, ({ number }) => `ABC-${number}`, () => new Date('2026-11-19T10:00:00.000Z'))
})

describe('the components of the built-in tracker (BTN-1288)', () => {
  it('lists the project’s components by name with their open and all tasks', async () => {
    const ui = await person().saveComponent(ABC, null, { name: ' UI ', description: 'The page' })
    await person().saveComponent(ABC, null, { name: 'server', description: '' })
    await person().saveComponent(XYZ, null, { name: 'Other', description: '' })
    await store.create({ project: ABC, title: 'One', component: 'ui' })
    await store.create({ project: ABC, title: 'Two', component: 'UI', status: 'Done' })
    await store.create({ project: ABC, title: 'Three' })
    expect(await store.components(ABC)).toEqual([
      { id: expect.any(String), name: 'server', description: '', createdAt: '2026-11-19T10:00:00.000Z', open: 0, total: 0 },
      { id: ui, name: 'UI', description: 'The page', createdAt: '2026-11-19T10:00:00.000Z', open: 1, total: 2 },
    ])
    expect((await store.get(abc(1)))?.component).toBe('UI')
    expect((await store.get(abc(3)))?.component).toBeNull()
  })

  it('refuses a blank name and a name the project has already, ignoring case', async () => {
    const ui = await store.saveComponent(ABC, null, { name: 'UI', description: '' })
    await store.saveComponent(ABC, null, { name: 'Server', description: '' })
    expect(await codeOf(store.saveComponent(ABC, null, { name: '  ', description: '' }))).toBe('builtin.emptyName')
    expect(await codeOf(store.saveComponent(ABC, null, { name: 'ui', description: '' }))).toBe('builtin.componentTaken')
    expect(await codeOf(store.saveComponent(ABC, ui, { name: 'SERVER', description: '' }))).toBe('builtin.componentTaken')
    expect(await codeOf(store.saveComponent(ABC, 'missing', { name: 'Web', description: '' }))).toBe('builtin.noComponent')
    expect(await codeOf(store.saveComponent(XYZ, ui, { name: 'Web', description: '' }))).toBe('builtin.noComponent')
    await store.saveComponent(ABC, ui, { name: 'ui', description: '' })
    expect((await store.components(ABC)).map((each) => each.name)).toEqual(['Server', 'ui'])
  })

  it('renames a component: its tasks carry the new name, their history keeps the old one', async () => {
    const ui = await store.saveComponent(ABC, null, { name: 'UI', description: '' })
    await store.create({ project: ABC, title: 'One', component: 'UI' })
    await person().saveComponent(ABC, ui, { name: 'Web', description: 'The page\nand the phone' })
    expect((await store.get(abc(1)))?.component).toBe('Web')
    expect((await store.history(abc(1))).map((each) => each.field)).toEqual(['created'])
    expect((await store.componentHistory(ui)).map((each) => [each.by, each.field, each.from, each.to])).toEqual([
      ['service', 'created', null, 'UI'],
      ['person', 'name', 'UI', 'Web'],
      ['person', 'description', null, expect.stringContaining('"added"')],
    ])
  })

  it('sets, changes and clears a task’s component by name; an unknown name is refused unless it is to be made', async () => {
    await store.saveComponent(ABC, null, { name: 'UI', description: '' })
    await store.create({ project: ABC, title: 'One' })
    const before = (await store.get(abc(1)))!.version
    await person().edit(abc(1), { field: 'component', from: null, to: 'ui' })
    expect((await store.get(abc(1)))?.component).toBe('UI')
    expect((await store.get(abc(1)))!.version).toBe(before + 1)
    expect(await codeOf(store.edit(abc(1), { field: 'component', from: 'UI', to: 'Billing' }))).toBe('builtin.noComponent')
    expect(await codeOf(store.edit(abc(1), { field: 'component', from: 'Server', to: null }))).toBe('builtin.conflict')
    await person().edit(abc(1), { field: 'component', from: 'UI', to: 'Billing', create: true })
    await person().edit(abc(1), { field: 'component', from: 'Billing', to: null })
    expect((await store.get(abc(1)))?.component).toBeNull()
    expect((await store.history(abc(1))).map((each) => [each.field, each.from, each.to])).toEqual([
      ['created', null, null],
      ['component', null, 'UI'],
      ['component', 'UI', 'Billing'],
      ['component', 'Billing', null],
    ])
    expect((await store.components(ABC)).map((each) => each.name)).toEqual(['Billing', 'UI'])
    expect(await codeOf(store.create({ project: ABC, title: 'Two', component: 'Nope' }))).toBe('builtin.noComponent')
  })

  it('deletes a component, moving its tasks, the closed ones too, to another one or to none', async () => {
    const ui = await store.saveComponent(ABC, null, { name: 'UI', description: '' })
    const web = await store.saveComponent(ABC, null, { name: 'Web', description: '' })
    const old = await store.saveComponent(ABC, null, { name: 'Old', description: '' })
    await store.create({ project: ABC, title: 'One', component: 'UI' })
    await store.create({ project: ABC, title: 'Two', component: 'UI', status: 'Done' })
    await store.create({ project: ABC, title: 'Three', component: 'Old' })
    expect(await codeOf(store.removeComponent(ABC, ui, ui))).toBe('builtin.noComponent')
    expect(await codeOf(store.removeComponent(ABC, ui, 'missing'))).toBe('builtin.noComponent')
    await person().removeComponent(ABC, ui, web)
    await person().removeComponent(ABC, old, null)
    expect((await store.list([ABC])).map((each) => each.component)).toEqual(['Web', 'Web', null])
    expect((await store.history(abc(2))).at(-1)).toMatchObject({ by: 'person', field: 'component', from: 'UI', to: 'Web' })
    expect((await store.history(abc(3))).at(-1)).toMatchObject({ field: 'component', from: 'Old', to: null })
    expect((await store.components(ABC)).map((each) => [each.name, each.total])).toEqual([['Web', 2]])
    expect((await store.componentHistory(ui)).at(-1)).toMatchObject({ by: 'person', field: 'removed', from: 'UI', to: null })
  })

  it('goes with the project', async () => {
    await store.saveComponent(ABC, null, { name: 'UI', description: '' })
    await store.forget(ABC)
    expect(await store.components(ABC)).toEqual([])
  })
})
