import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventHub } from './events.js'
import { createEvenKeelServer, type ServerDeps } from './server.js'
import { fail } from './notice/notice.js'

const servers: ReturnType<typeof createEvenKeelServer>[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function fixture() {
  const relabel = vi.fn(async (task: string) => {
    if (task === 'APP-9') throw fail('task.relabelFailed', { task })
  })
  const server = createEvenKeelServer({
    tasks: { relabel }, hub: new EventHub(), getState: () => ({}),
    guard: () => ({ hosts: new Set(['127.0.0.1']), token: null }),
  } as unknown as ServerDeps)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/task/labels`
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { relabel, post }
}

describe('task label HTTP command', () => {
  it('passes both lists in one operation, and publishes a tracker refusal as a notice code', async () => {
    const { relabel, post } = await fixture()
    expect((await post({ task: 'APP-1', add: ['New'], remove: ['Old'] })).status).toBe(200)
    expect(relabel).toHaveBeenCalledWith('APP-1', { add: ['New'], remove: ['Old'] })
    const refused = await post({ task: 'APP-9', add: [], remove: [] })
    expect(refused.status).toBe(400)
    expect((await refused.json()).notice).toEqual({ code: 'task.relabelFailed', params: { task: 'APP-9' } })
  })

  it.each([
    {}, { task: 'APP-1' }, { task: 'APP-1', add: 'New', remove: [] },
    { task: 'APP-1', add: [], remove: [1] }, { task: 'APP-1', add: ['  '], remove: [] },
  ])('rejects malformed input before calling the tracker: %j', async (body) => {
    const { relabel, post } = await fixture()
    expect((await post(body)).status).toBe(400)
    expect(relabel).not.toHaveBeenCalled()
  })
})
