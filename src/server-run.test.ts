import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventHub } from './events.js'
import { createEvenKeelServer, type ServerDeps } from './server.js'

const servers: ReturnType<typeof createEvenKeelServer>[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function fixture() {
  const setRun = vi.fn()
  const server = createEvenKeelServer({
    tasks: { setRun }, hub: new EventHub(), getState: () => ({}),
    guard: () => ({ hosts: new Set(['127.0.0.1']), token: null }),
  } as unknown as ServerDeps)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/task/run`
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { setRun, post }
}

describe('task run HTTP command (BTN-983)', () => {
  it('passes the checked run on, an effort alone too, and nothing set as no run', async () => {
    const { setRun, post } = await fixture()
    expect((await post({ task: 'APP-1', provider: 'Codex', model: ' gpt-example ', effort: 'high' })).status).toBe(200)
    expect((await post({ task: 'APP-1', effort: 'max' })).status).toBe(200)
    expect((await post({ task: 'APP-1', provider: null, model: '', effort: null })).status).toBe(200)
    expect(setRun.mock.calls).toEqual([
      ['APP-1', { provider: 'codex', model: 'gpt-example', effort: 'high' }],
      ['APP-1', { provider: null, model: null, effort: 'max' }],
      ['APP-1', null],
    ])
  })

  it.each([
    [{ provider: 'codex' }, 'request.required'],
    [{ task: 'APP-1', provider: 'gemini' }, 'run.unknownProvider'],
    [{ task: 'APP-1', model: 'opus' }, 'run.modelWithoutProvider'],
    [{ task: 'APP-1', provider: 'claude', effort: 'minimal' }, 'run.unknownEffort'],
    [{ task: 'APP-1', provider: 'codex', effort: 'max' }, 'run.unknownEffort'],
  ])('refuses %j with %s and keeps nothing', async (body, code) => {
    const { setRun, post } = await fixture()
    const refused = await post(body)
    expect(refused.status).toBe(400)
    expect((await refused.json()).notice.code).toBe(code)
    expect(setRun).not.toHaveBeenCalled()
  })
})
