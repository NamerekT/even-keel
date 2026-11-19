import type { AddressInfo } from 'node:net'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtinControl, builtinPlaces } from './builtin/control.js'
import { EventHub } from './events.js'
import { fail } from './notice/notice.js'
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

type Renamed = (project: string, from: string, to: string | null) => void

async function fixture(busy: (task: string) => 'current' | 'live' | null = () => null, rename: Renamed = () => {}) {
  const refresh = vi.fn(async () => true)
  const renamed = vi.fn(rename)
  const control = builtinControl({ db, places: () => builtinPlaces(CONFIG), refresh, busy, renamed })
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
  const list = async () => (await post('milestones', { project: ABC })).body as { id: string; name: string; status: string; closedAt: string | null; openTasks: string[] }[]
  return { refresh, renamed, post, list }
}

describe('the built-in tracker’s milestones over HTTP (BTN-1287)', () => {
  it('creates, edits and lists milestones, telling the settings of a rename', async () => {
    const { post, list, refresh, renamed } = await fixture()
    const made = await post('milestone/save', { project: ABC, id: null, name: 'v1', description: 'First.', status: 'active', date: Date.UTC(2026, 11, 1) })
    expect(made.status).toBe(200)
    expect(refresh).toHaveBeenCalledWith(ABC)
    const taken = await post('milestone/save', { project: ABC, id: null, name: 'V1' })
    expect(taken.body.notice).toEqual({ code: 'builtin.milestoneTaken', params: { name: 'V1' } })
    await post('create', { project: ABC, title: 'Task', milestone: 'v1' })
    await post('milestone/save', { project: ABC, id: made.body.id, name: 'v1.0', description: 'First.', status: 'completed', date: null })
    expect(renamed).toHaveBeenCalledWith(ABC, 'v1', 'v1.0')
    const [milestone] = await list()
    expect(milestone).toMatchObject({ name: 'v1.0', status: 'completed', openTasks: ['ABC-1'] })
    expect(milestone!.closedAt).not.toBeNull()
    expect((await post('milestone/save', { project: ABC, id: null, name: 'v2', status: 'done' })).status).toBe(400)
  })

  it('undoes a rename the settings refuse', async () => {
    const { post, list } = await fixture(() => null, () => {
      throw fail('builtin.milestoneRequired', { milestone: 'v1' })
    })
    const made = await post('milestone/save', { project: ABC, id: null, name: 'v1' })
    const refused = await post('milestone/delete', { project: ABC, id: made.body.id, to: null })
    expect(refused.body.notice).toEqual({ code: 'builtin.milestoneRequired', params: { milestone: 'v1' } })
    expect((await list()).map((each) => each.name)).toEqual(['v1'])
  })

  it('deletes a milestone moving its tasks, refused while an open one is busy or one is closed', async () => {
    const { post, list, renamed } = await fixture((task) => (task === 'ABC-1' ? 'current' : null))
    await post('create', { project: ABC, title: 'a', milestone: 'v1' })
    await post('create', { project: ABC, title: 'b', milestone: 'v2' })
    await post('create', { project: ABC, title: 'c', milestone: 'v3', status: 'Done' })
    const [v1, v2, v3] = await list()
    const busy = await post('milestone/delete', { project: ABC, id: v1!.id, to: null })
    expect(busy.body.notice).toEqual({ code: 'builtin.milestoneBusy', params: { milestone: 'v1', task: 'ABC-1', why: 'current' } })
    const closed = await post('milestone/delete', { project: ABC, id: v3!.id, to: null })
    expect(closed.body.notice).toEqual({ code: 'builtin.milestoneClosedTasks', params: { milestone: 'v3', count: 1 } })
    expect((await post('milestone/delete', { project: ABC, id: v2!.id, to: v1!.id })).status).toBe(200)
    expect(renamed).toHaveBeenCalledWith(ABC, 'v2', null)
    expect((await list()).map((each) => [each.name, each.openTasks])).toEqual([['v1', ['ABC-1', 'ABC-2']], ['v3', []]])
  })
})
