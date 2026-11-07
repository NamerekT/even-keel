import type { AddressInfo } from 'node:net'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtinControl, builtinPlaces } from './builtin/control.js'
import { EventHub } from './events.js'
import { createEvenKeelServer, type ServerDeps } from './server.js'
import { openDatabase } from './storage/database.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'
const HULY = '33333333-3333-4333-8333-333333333333'
const CONFIG = { trackers: { [ABC]: 'builtin', [XYZ]: 'builtin', [HULY]: 'huly' }, keys: { [ABC]: 'ABC', [XYZ]: 'XYZ', [HULY]: 'HUL' } }

let db: PGlite
const servers: ReturnType<typeof createEvenKeelServer>[] = []
beforeAll(async () => {
  db = await openDatabase(undefined)
}, 120_000)
afterAll(() => db.close())
beforeEach(() => db.exec('truncate builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_task_labels, builtin_relations, builtin_comments'))
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function fixture(withBuiltin = true) {
  const refresh = vi.fn(async () => true)
  const server = createEvenKeelServer({
    ...(withBuiltin ? { builtin: builtinControl({ db, places: () => builtinPlaces(CONFIG), refresh }) } : {}),
    hub: new EventHub(), getState: () => ({}),
    guard: () => ({ hosts: new Set(['127.0.0.1']), token: null }),
  } as unknown as ServerDeps)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/builtin/`
  const post = async (command: string, body: unknown) => {
    const response = await fetch(base + command, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  return { refresh, post }
}

describe('the built-in tracker over HTTP', () => {
  it('creates a task with a new label and milestone, edits it field by field and refreshes the project', async () => {
    const { refresh, post } = await fixture()
    const created = await post('create', { project: ABC, title: 'First', labels: ['Bug'], milestone: 'v0.3', priority: 'high' })
    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({ id: 'ABC-1', labels: ['Bug'], milestone: { name: 'v0.3' }, priority: 'high', status: { name: 'Todo' } })
    expect(refresh).toHaveBeenCalledWith(ABC)
    expect((await post('edit', { task: 'ABC-1', field: 'status', from: 'Todo', to: 'In Progress' })).body.status.name).toBe('In Progress')
    // Another editor saw Todo and set a title: another field, no conflict.
    expect((await post('edit', { task: 'ABC-1', field: 'title', from: 'First', to: 'Renamed' })).body.title).toBe('Renamed')
    const conflict = await post('edit', { task: 'ABC-1', field: 'status', from: 'Todo', to: 'Backlog' })
    expect(conflict.status).toBe(400)
    expect(conflict.body.notice).toEqual({ code: 'builtin.conflict', params: { task: 'ABC-1', field: 'status', current: 'In Progress' } })
  })

  it('replaces the description by its revision and patches it without one', async () => {
    const { post } = await fixture()
    await post('create', { project: ABC, title: 'Doc' })
    expect((await post('description', { task: 'ABC-1', text: 'one two', rev: 0 })).body.descriptionRev).toBe(1)
    expect((await post('description', { task: 'ABC-1', text: 'stale', rev: 0 })).body.notice.code).toBe('builtin.descriptionConflict')
    expect((await post('patch', { task: 'ABC-1', old: 'two', new: 'three' })).body).toMatchObject({ description: 'one three', descriptionRev: 2 })
    expect((await post('patch', { task: 'ABC-1', old: 'nothing', new: 'x' })).body.notice.code).toBe('builtin.patchMissing')
  })

  it('links tasks across its projects, sets a parent by id, comments and deletes without traces', async () => {
    const { refresh, post } = await fixture()
    await post('create', { project: ABC, title: 'Parent' })
    await post('create', { project: ABC, title: 'Child', parent: 'ABC-1' })
    await post('create', { project: XYZ, title: 'Blocker' })
    expect((await post('relate', { task: 'XYZ-1', other: 'ABC-2', kind: 'blocks' })).body.blocks).toEqual(['ABC-2'])
    expect(refresh).toHaveBeenCalledWith(XYZ)
    expect((await post('labels', { task: 'ABC-2', add: ['Rework'] })).body.labels).toEqual(['Rework'])
    expect((await post('edit', { task: 'ABC-2', field: 'parent', from: 'ABC-1', to: null })).body.parent).toBeNull()
    expect((await post('edit', { task: 'ABC-2', field: 'parent', from: null, to: 'XYZ-1' })).body.notice.code).toBe('builtin.noTask')
    expect((await post('comment', { task: 'ABC-2', text: 'Looks done.' })).body.id).toMatch(/^\d+$/)
    expect((await post('milestone', { project: XYZ, name: 'v1', date: 1795000000000 })).body.id).toEqual(expect.any(String))
    expect((await post('delete', { task: 'ABC-2' })).status).toBe(200)
    expect((await post('unrelate', { task: 'XYZ-1', other: 'ABC-2', kind: 'blocks' })).body.notice.code).toBe('builtin.noTask')
    expect((await post('labels', { task: 'XYZ-1', add: [] })).body.blocks).toEqual([])
  })

  it('deletes a person\'s own note only, and writes an answer from the chat into a built-in task\'s journal only', async () => {
    const { post } = await fixture()
    const control = builtinControl({ db, places: () => builtinPlaces(CONFIG), refresh: async () => true })
    await post('create', { project: ABC, title: 'Asked' })
    const note = (await post('comment', { task: 'ABC-1', text: 'A note.' })).body.id as string
    expect(await control.answered(ABC, 'ABC-1', 'The answer.')).toBe(true)
    expect(await control.answered(XYZ, 'ABC-1', 'Elsewhere.')).toBe(false)
    expect(await control.answered(HULY, 'HUL-1', 'Not ours.')).toBe(false)
    expect(await control.answered(ABC, 'ABC-9', 'No task.')).toBe(false)
    expect((await post('uncomment', { task: 'ABC-1', comment: note })).status).toBe(200)
    const again = await post('uncomment', { task: 'ABC-1', comment: note })
    expect(again.body.notice).toEqual({ code: 'builtin.noNote', params: { task: 'ABC-1' } })
    const rows = await db.query<{ author: string; body: string }>('select author, body from builtin_comments order by id')
    expect(rows.rows).toEqual([{ author: 'person', body: 'The answer.' }])
  })

  it('finds tasks by id or title in one project or all, and gives a task its ancestors, subtasks and labels', async () => {
    const { post } = await fixture()
    await post('create', { project: ABC, title: 'Root' })
    await post('create', { project: ABC, title: 'Middle', parent: 'ABC-1', milestone: 'v0.3' })
    await post('create', { project: XYZ, title: 'Rooted elsewhere' })
    expect((await post('search', { text: 'root' })).body.map((task: { id: string }) => task.id)).toEqual(['ABC-1', 'XYZ-1'])
    expect((await post('search', { text: 'root', project: ABC })).body.map((task: { id: string }) => task.id)).toEqual(['ABC-1'])
    expect((await post('search', { text: 'abc-2' })).body).toEqual([{ id: 'ABC-2', title: 'Middle', status: { name: 'Todo', category: 'ToDo' } }])
    const source = (await import('./builtin/source.js')).builtinSource(db, builtinPlaces(CONFIG))
    await post('create', { project: ABC, title: 'Leaf', parent: 'ABC-2', labels: ['Claude | opus', 'Later'] })
    const leaf = await source.card!('ABC-3')
    expect(leaf.edit!.ancestors.map((task) => task.id)).toEqual(['ABC-1', 'ABC-2'])
    expect(leaf.edit!.labels).toEqual([
      { name: 'Manual', builtin: true }, { name: 'Question', builtin: true }, { name: 'Bug', builtin: true }, { name: 'Rework', builtin: true },
      { name: 'Later', builtin: false },
    ])
    expect((await source.card!('ABC-1')).edit!.subtasks).toEqual([{ id: 'ABC-2', title: 'Middle', status: { name: 'Todo', category: 'ToDo' }, milestone: 'v0.3' }])
  })

  it('refuses to delete the chain’s current task or one with a live session', async () => {
    const refresh = vi.fn(async () => true)
    const busy = (task: string) => (task === 'ABC-1' ? 'current' : task === 'ABC-2' ? 'live' : null)
    const control = builtinControl({ db, places: () => builtinPlaces(CONFIG), refresh, busy })
    for (const title of ['a', 'b', 'c']) await control.create(ABC, { title })
    await expect(control.remove('ABC-1')).rejects.toMatchObject({ notice: { code: 'builtin.removeBusy', params: { task: 'ABC-1', why: 'current' } } })
    await expect(control.remove('ABC-2')).rejects.toMatchObject({ notice: { code: 'builtin.removeBusy', params: { why: 'live' } } })
    await control.remove('ABC-3')
    expect((await control.search('', ABC)).map((task) => task.id)).toEqual(['ABC-2', 'ABC-1'])
  })

  it('says whether a project holds tasks, a deleted one leaving none', async () => {
    const control = builtinControl({ db, places: () => builtinPlaces(CONFIG), refresh: async () => true })
    expect(await control.holds(ABC)).toBe(false)
    await control.create(ABC, { title: 'only' })
    expect(await control.holds(ABC)).toBe(true)
    expect(await control.holds(XYZ)).toBe(false)
    await control.remove('ABC-1')
    expect(await control.holds(ABC)).toBe(false)
  })

  it('refuses a project on another tracker, a bad priority, and every command without the database', async () => {
    const { post } = await fixture()
    expect((await post('create', { project: HULY, title: 'x' })).body.notice.code).toBe('builtin.noProject')
    expect((await post('create', { project: ABC, title: 'x', priority: 'asap' })).body.notice.code).toBe('builtin.badPriority')
    expect((await post('edit', { task: 'ABC-1', field: 'labels', from: 'a', to: 'b' })).body.notice).toEqual({ code: 'request.required', params: { field: 'field' } })
    const off = await fixture(false)
    expect((await off.post('create', { project: ABC, title: 'x' })).body.notice.code).toBe('builtin.off')
  })
})
