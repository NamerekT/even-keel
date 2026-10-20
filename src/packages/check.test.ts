import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { fail, noticeOf } from '../notice/notice.js'
import { bringsServer, Probes, projectPackages, type CheckInput } from './check.js'
import type { PackageInstall, PackagesFile } from './model.js'

const install = (servers: string[], extras = false): PackageInstall => ({
  id: 'i1',
  version: '1.0.0',
  at: '2026-10-17T10:00:00.000Z',
  servers: Object.fromEntries(servers.map((server) => [server, { entry: { command: 'node', args: [server] }, npm: null }])),
  extras,
})

const file = (): PackagesFile => ({
  packages: {
    'huly@even-keel': { kind: 'plugin', plugin: { name: 'huly', marketplace: 'even-keel' }, default: true, settings: { TOOLSETS: 'all' }, installs: [install(['huly'], true)] },
    db: { kind: 'mcp', server: { command: 'db' }, default: false, settings: {}, installs: [] },
  },
  projects: {},
  pins: {},
})

const input = (over: Partial<CheckInput> = {}): CheckInput => ({
  file: file(),
  project: 'p-1',
  agent: 'claude',
  installing: new Set(),
  errors: new Map(),
  keys: () => ({ values: {}, env: {}, missing: [], names: [] }),
  probe: () => true,
  ...over,
})

describe('projectPackages', () => {
  it('lets a project whose set is installed, keyed and answering run', () => {
    const view = projectPackages(input())
    expect(view.blocked).toBe(false)
    expect(view.cells['huly@even-keel']).toEqual({ choice: null, enabled: true, settings: { TOOLSETS: 'all' }, problems: [] })
    expect(view.cells.db).toMatchObject({ enabled: false, problems: [] })
  })

  it('holds the chain on a package of the set that is not installed, and tells an install that failed', () => {
    const own = file()
    own.projects['p-1'] = { on: ['db'], off: [], settings: {} }
    expect(projectPackages(input({ file: own })).cells.db).toMatchObject({ choice: 'on', problems: [{ kind: 'notInstalled' }] })
    expect(projectPackages(input({ file: own, installing: new Set(['db']) })).cells.db!.problems).toEqual([{ kind: 'installing' }])
    const error = noticeOf(fail('packages.npmFailed', { spec: 'db@1' }))
    const failed = projectPackages(input({ file: own, errors: new Map([['db', error]]) }))
    expect(failed.cells.db!.problems).toEqual([{ kind: 'installFailed', notice: error }])
    expect(failed.blocked).toBe(true)
  })

  it('names the variables a server lacks and holds the chain', () => {
    const view = projectPackages(input({ keys: () => ({ values: {}, env: {}, missing: ['HULY_TOKEN'], names: ['HULY_TOKEN'] }) }))
    expect(view.cells['huly@even-keel']!.problems).toEqual([{ kind: 'noKey', variables: ['HULY_TOKEN'] }])
    expect(view.blocked).toBe(true)
  })

  it('holds the chain on a server that failed its probe, and on one not probed yet', () => {
    expect(projectPackages(input({ probe: () => false })).cells['huly@even-keel']!.problems).toEqual([{ kind: 'noResponse', servers: ['huly'] }])
    const unprobed = projectPackages(input({ probe: () => undefined }))
    expect(unprobed.cells['huly@even-keel']!.problems).toEqual([{ kind: 'probing' }])
    expect(unprobed.blocked).toBe(true)
  })

  it('wants the tracker server when brief is off', () => {
    expect(projectPackages(input({ tracker: { server: 'huly', required: true } })).problems).toEqual([])
    const own = file()
    own.projects['p-1'] = { on: [], off: ['huly@even-keel'], settings: {} }
    const view = projectPackages(input({ file: own, tracker: { server: 'huly', required: true } }))
    expect(view.problems).toEqual([{ kind: 'noTrackerMcp', server: 'huly' }])
    expect(view.cells['huly@even-keel']).toMatchObject({ choice: 'off', enabled: false })
    expect(view.blocked).toBe(true)
  })

  it('tells whether the set brings the tracker server whatever brief is, and holds nothing without brief off', () => {
    expect(projectPackages(input({ tracker: { server: 'huly', required: false } })).tracker).toEqual({ server: 'huly', brought: true })
    const own = file()
    own.projects['p-1'] = { on: [], off: ['huly@even-keel'], settings: {} }
    const view = projectPackages(input({ file: own, tracker: { server: 'huly', required: false } }))
    expect(view.tracker).toEqual({ server: 'huly', brought: false })
    expect(view.problems).toEqual([])
    expect(view.blocked).toBe(false)
    expect(projectPackages(input()).tracker).toBeNull()
  })

  it('tells whether an enabled package of the project brings a server', () => {
    expect(bringsServer(file(), 'p-1', 'huly')).toBe(true)
    expect(bringsServer(file(), 'p-1', 'linear')).toBe(false)
    const off = file()
    off.projects['p-1'] = { on: [], off: ['huly@even-keel'], settings: {} }
    expect(bringsServer(off, 'p-1', 'huly')).toBe(false)
    const removed = file()
    removed.packages['huly@even-keel']!.removed = true
    expect(bringsServer(removed, 'p-1', 'huly')).toBe(false)
  })

  it('notes a plugin with skills for an agent without plugins, and does not hold the chain for it', () => {
    const view = projectPackages(input({ agent: 'other' }))
    expect(view.cells['huly@even-keel']!.problems).toEqual([{ kind: 'unsupported', agent: 'other' }])
    expect(view.blocked).toBe(false)
  })

  it('has no note for Codex, which reads the plugins too', () => {
    expect(projectPackages(input({ agent: 'codex' })).cells['huly@even-keel']!.problems).toEqual([])
  })

  it('leaves removed packages out', () => {
    const own = file()
    own.packages.db!.removed = true
    expect(projectPackages(input({ file: own })).cells.db).toBeUndefined()
  })
})

describe('Probes', () => {
  let server: Server | undefined

  afterEach(async () => {
    server?.closeAllConnections()
    await new Promise((resolve) => (server === undefined ? resolve(undefined) : server.close(resolve)))
    server = undefined
  })

  it('counts a server silent until its first answer as starting, and silence after an answer as a failure', async () => {
    let mode: 'hang' | 'ok' | 'fail' = 'hang'
    server = createServer((_req, res) => {
      if (mode === 'ok') res.writeHead(200, { 'content-type': 'application/json' }).end('{"jsonrpc":"2.0","id":0,"result":{}}')
      else if (mode === 'fail') res.writeHead(502).end()
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`
    let now = 0
    const probes = new Probes({ urlOf: () => url, now: () => now, onChange: () => {}, timeoutMs: 50 })
    const settle = async () => {
      probes.result('p-1', 'huly', 'i1', 'huly')
      await new Promise((resolve) => setTimeout(resolve, 250))
      return probes.result('p-1', 'huly', 'i1', 'huly')
    }
    expect(await settle()).toBeUndefined()
    now += 31_000
    mode = 'ok'
    expect(await settle()).toBe(true)
    now += 6 * 60_000
    mode = 'hang'
    expect(await settle()).toBe(false)
    probes.forget('huly')
    expect(await settle()).toBeUndefined()
    now += 31_000
    mode = 'fail'
    expect(await settle()).toBe(false)
  })
})
