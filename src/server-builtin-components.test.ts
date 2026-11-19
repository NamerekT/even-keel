import type { AddressInfo } from 'node:net'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtinControl, builtinPlaces } from './builtin/control.js'
import { EventHub } from './events.js'
import { createEvenKeelServer, type ServerDeps } from './server.js'
import { openDatabase } from './storage/database.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const CONFIG = { trackers: { [ABC]: 'builtin' }, keys: { [ABC]: 'ABC' } }

let db: PGlite
const servers: ReturnType<typeof createEvenKeelServer>[] = []
beforeAll(async () => {
  db = await openDatabase(undefined)
}, 120_000)
afterAll(() => db.close())
beforeEach(() => db.exec('truncate builtin_history, builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_components, builtin_task_labels, builtin_relations, builtin_comments, builtin_files'))
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function fixture(busy: (task: string) => 'current' | 'live' | null = () => null) {
  const refresh = vi.fn(async () => true)
  const control = builtinControl({ db, places: () => builtinPlaces(CONFIG), refresh, busy })
  const server = createEvenKeelServer({
    builtin: control,
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

describe('the built-in tracker’s components and estimate over HTTP (BTN-1288)', () => {
  it('creates, renames and lists components, refusing a taken name', async () => {
    const { post, refresh } = await fixture()
    const made = await post('component', { project: ABC, id: null, name: 'Parser', description: '' })
    expect(made.status).toBe(200)
    expect(refresh).toHaveBeenCalledWith(ABC)
    await post('component', { project: ABC, name: 'docs' })
    const taken = await post('component', { project: ABC, id: null, name: 'PARSER' })
    expect(taken.body.notice).toEqual({ code: 'builtin.componentTaken', params: { name: 'PARSER' } })
    await post('component', { project: ABC, id: made.body.id, name: 'Reader', description: 'Reads the input.' })
    const list = (await post('components', { project: ABC })).body as { name: string; description: string }[]
    expect(list.map((each) => [each.name, each.description])).toEqual([['docs', ''], ['Reader', 'Reads the input.']])
  })

  it('sets a task’s component from the card, creating a new one by name', async () => {
    const { post } = await fixture()
    await post('create', { project: ABC, title: 'Task' })
    const set = await post('edit', { task: 'ABC-1', field: 'component', from: null, to: 'Parser', create: true })
    expect(set.body.component).toBe('Parser')
    const unknown = await post('edit', { task: 'ABC-1', field: 'component', from: 'Parser', to: 'Docs' })
    expect(unknown.body.notice.code).toBe('builtin.noComponent')
    expect((await post('edit', { task: 'ABC-1', field: 'component', from: 'Parser', to: null })).body.component).toBeNull()
  })

  it('deletes a component moving its tasks, refused while one of them is busy', async () => {
    const { post } = await fixture((task) => (task === 'ABC-1' ? 'live' : null))
    for (const title of ['a', 'b']) await post('create', { project: ABC, title })
    await post('edit', { task: 'ABC-1', field: 'component', from: null, to: 'Parser', create: true })
    await post('edit', { task: 'ABC-2', field: 'component', from: null, to: 'Docs', create: true })
    const [docs, parser] = (await post('components', { project: ABC })).body as { id: string }[]
    const busy = await post('component/delete', { project: ABC, id: parser!.id, to: null })
    expect(busy.body.notice).toEqual({ code: 'builtin.componentBusy', params: { component: 'Parser', task: 'ABC-1', why: 'live' } })
    expect((await post('component/delete', { project: ABC, id: docs!.id, to: parser!.id })).status).toBe(200)
    const left = (await post('components', { project: ABC })).body as { name: string; total: number }[]
    expect(left.map((each) => [each.name, each.total])).toEqual([['Parser', 2]])
  })

  it('sets and clears the estimate from the card', async () => {
    const { post } = await fixture()
    await post('create', { project: ABC, title: 'Task' })
    expect((await post('estimate', { task: 'ABC-1', minutes: 80 })).body.estimate).toBe(80)
    expect((await post('estimate', { task: 'ABC-1', minutes: null })).body.estimate).toBeNull()
    expect((await post('estimate', { task: 'ABC-1', minutes: 'soon' })).status).toBe(400)
  })
})
