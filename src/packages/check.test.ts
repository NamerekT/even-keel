import { describe, expect, it } from 'vitest'
import { fail, noticeOf } from '../notice/notice.js'
import { projectPackages, type CheckInput } from './check.js'
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
    expect(projectPackages(input({ trackerServer: 'huly' })).problems).toEqual([])
    const own = file()
    own.projects['p-1'] = { on: [], off: ['huly@even-keel'], settings: {} }
    const view = projectPackages(input({ file: own, trackerServer: 'huly' }))
    expect(view.problems).toEqual([{ kind: 'noTrackerMcp', server: 'huly' }])
    expect(view.cells['huly@even-keel']).toMatchObject({ choice: 'off', enabled: false })
    expect(view.blocked).toBe(true)
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
