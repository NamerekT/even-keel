import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { routeOf } from '../packages/launch.js'
import type { Queryable } from '../storage/database.js'
import { memoryDatabase } from '../storage/memory.js'
import { HubMcp, machineFolderOf } from './hub-mcp.js'

let db: Queryable
let upstream: Server | undefined
let origin: string | undefined
let seen: { url: string; body: string }[]
let reply: { status: number; body: string }
let lines: string[]

const hub = () => new HubMcp({ db, origin: () => origin, projects: () => ['p-1', 'p-2'], log: (line) => void lines.push(line) })
const pool = (project: string, machine: string) => db.query('insert into project_machines (project_id, machine_id) values ($1, $2)', [project, machine])

beforeEach(async () => {
  db = await memoryDatabase()
  seen = []
  lines = []
  reply = { status: 200, body: '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Commented."}]}}' }
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      seen.push({ url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(reply.status, { 'content-type': 'application/json', 'mcp-session-id': 'm-1' }).end(reply.body)
    })
  })
  await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
})

afterEach(async () => {
  await new Promise((resolve) => upstream!.close(resolve))
})

const write = (path: string) => ({ path, message: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'task_comment', arguments: { key: 'ABC-1', text: 'done' } } } })

describe('the hub’s side of a machine’s MCP servers (BTN-990)', () => {
  it('admits a machine only to the servers of the projects in its pool, and to /tasks alone only with every project', async () => {
    await pool('p-1', 'm-a')
    await pool('p-2', 'm-b')
    await pool('p-1', 'm-b')
    const relay = hub()
    expect(await relay.admits('m-a', '/tasks/p-1?task=ABC-1')).toBe(true)
    expect(await relay.admits('m-a', routeOf('p-1', 'huly', 'i1', 'huly'))).toBe(true)
    expect(await relay.admits('m-a', routeOf('p-2', 'huly', 'i1', 'huly'))).toBe(false)
    expect(await relay.admits('m-a', '/tasks')).toBe(false)
    expect(await relay.admits('m-b', '/tasks')).toBe(true)
    expect(await relay.admits('m-a', '/other')).toBe(false)
  })

  it('asks the hub’s gateway for an admitted machine and gives its answer back whole; refuses another one', async () => {
    await pool('p-1', 'm-a')
    const relay = hub()
    const answer = await relay.relay('m-a', { path: '/tasks/p-1?task=ABC-1', method: 'POST', headers: { 'content-type': 'application/json', cookie: 'x' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' })
    expect(answer).toEqual({ status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'm-1' }, body: reply.body })
    expect(seen).toEqual([{ url: '/tasks/p-1?task=ABC-1', body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' }])
    expect((await relay.relay('m-z', { path: '/tasks/p-1', method: 'POST', headers: {}, body: '{}' })).status).toBe(403)
    expect(seen).toHaveLength(1)
    origin = undefined
    expect((await relay.relay('m-a', { path: '/tasks/p-1', method: 'POST', headers: {}, body: '{}' })).status).toBe(503)
  })

  it('makes a kept write once it is back; throws while its gateway cannot, drops one the tasks server refused', async () => {
    await pool('p-1', 'm-a')
    const relay = hub()
    await relay.write('m-a', write('/tasks/p-1?task=ABC-1'))
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ params: { name: 'task_comment' } })
    expect(lines.at(-1)).toMatch(/delivered a task_comment/)
    reply = { status: 200, body: '{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":[{"type":"text","text":"no such task"}]}}' }
    await relay.write('m-a', write('/tasks/p-1'))
    expect(lines.at(-1)).toMatch(/dropped: no such task/)
    await relay.write('m-z', write('/tasks/p-1'))
    expect(lines.at(-1)).toMatch(/dropped: answered 403/)
    origin = undefined
    await expect(relay.write('m-a', write('/tasks/p-1'))).rejects.toThrow(/503/)
  })
})

describe('the working folder of a call on the machine', () => {
  const ctx = {
    sessions: [{ task: 'ABC-1', lamp: 'busy', cwd: 'D:/work/abc-1' }, { task: 'ABC-2', lamp: 'finished', cwd: 'D:/work/abc-2' }],
    configStore: { current: { projects: { 'p-1': 'D:/repos/one', 'p-2': 'D:/repos/two' } } },
    readers: () => ({ projects: { 'p-1': {}, 'p-2': {} }, keys: { 'p-1': 'ABC', 'p-2': 'XYZ' }, trackers: {}, trackerProjects: {}, owners: {} }),
  } as unknown as Parameters<typeof machineFolderOf>[0]

  it('is the live session’s worktree, else the repository of the project the call names, else of the address', () => {
    expect(machineFolderOf(ctx, { project: 'p-1', task: 'ABC-1' }, 'ABC-1')).toBe('D:/work/abc-1')
    expect(machineFolderOf(ctx, { project: 'p-1', task: 'ABC-2' }, null)).toBe('D:/repos/one')
    expect(machineFolderOf(ctx, { project: null, task: null }, 'XYZ-4')).toBe('D:/repos/two')
    expect(machineFolderOf(ctx, { project: null, task: null }, 'xyz')).toBe('D:/repos/two')
    expect(machineFolderOf(ctx, { project: null, task: null }, 'NOPE-1')).toBeNull()
  })
})
