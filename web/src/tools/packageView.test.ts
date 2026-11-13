import { describe, expect, it } from 'vitest'
import type { PackagesView, PackageView, ProjectPackages } from '../../../src/state.js'
import { heldLong, importOffers, passes, keyLabel, marketplaceCommand, problemCount, serverEntry, shownPackages, trackerDoubled, trackerPackage, trackerPackageOf } from './packageView.js'

const project = (blocked: boolean, problems: ProjectPackages['problems'] = []): ProjectPackages => ({ cells: {}, problems, blocked, tracker: null })

const view = (over: Partial<PackagesView> = {}): PackagesView => ({
  gateway: null,
  packages: [],
  projects: {},
  keys: [],
  available: [],
  marketplace: null,
  imports: {},
  skills: { package: 'my-skills@even-keel-skills', list: [] },
  ...over,
})

describe('serverEntry', () => {
  it('makes an address a url entry', () => {
    expect(serverEntry('http', ' https://mcp.example.com/mcp ', '')).toEqual({ type: 'http', url: 'https://mcp.example.com/mcp' })
  })

  it('makes a command an entry with its arguments, a quoted argument whole', () => {
    expect(serverEntry('stdio', 'npx -y @example/db-mcp@1', '')).toEqual({ command: 'npx', args: ['-y', '@example/db-mcp@1'] })
    expect(serverEntry('stdio', 'db-mcp', '')).toEqual({ command: 'db-mcp', args: [] })
    expect(serverEntry('stdio', 'uv --directory "C:\\Program Files\\db mcp" run server.py', '')).toEqual({
      command: 'uv',
      args: ['--directory', 'C:\\Program Files\\db mcp', 'run', 'server.py'],
    })
  })

  it('puts the lines into the headers of an address and the environment of a command', () => {
    expect(serverEntry('http', 'https://mcp.example.com/mcp', 'Authorization: Bearer ${DB_TOKEN}\n\n X-Team : core ')).toEqual({
      type: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer ${DB_TOKEN}', 'X-Team': 'core' },
    })
    expect(serverEntry('stdio', 'db-mcp', 'DB_URL=postgres://db.example.com/app?a=b\nDB_TOKEN=${DB_TOKEN}')).toEqual({
      command: 'db-mcp',
      args: [],
      env: { DB_URL: 'postgres://db.example.com/app?a=b', DB_TOKEN: '${DB_TOKEN}' },
    })
  })

  it('gives nothing for an empty field, an address that is not one, or a line without its separator', () => {
    expect(serverEntry('stdio', '   ', '')).toBeNull()
    expect(serverEntry('http', 'mcp.example.com', '')).toBeNull()
    expect(serverEntry('http', 'https://mcp.example.com/mcp', 'Authorization Bearer x')).toBeNull()
    expect(serverEntry('stdio', 'db-mcp', 'DB_URL: x')).toBeNull()
    expect(serverEntry('stdio', 'db-mcp', '=x')).toBeNull()
  })
})

describe('heldLong', () => {
  it('is false for a project not held, or held only while a package installs or is probed', () => {
    const cell = (enabled: boolean, problems: ProjectPackages['problems']) => ({ choice: null, enabled, own: {}, problems })
    const held = (cells: ProjectPackages['cells']): ProjectPackages => ({ cells, problems: [], blocked: true, tracker: null })
    expect(heldLong(project(false))).toBe(false)
    expect(heldLong(project(true))).toBe(true)
    expect(heldLong(held({ a: cell(true, [{ kind: 'installing' }]), b: cell(true, [{ kind: 'probing' }]), c: cell(false, [{ kind: 'notInstalled' }]) }))).toBe(false)
    expect(heldLong(held({ a: cell(true, [{ kind: 'probing' }]), b: cell(true, [{ kind: 'noResponse', servers: ['b'] }]) }))).toBe(true)
  })
})

describe('passes', () => {
  it('is true only for a problem that goes by itself: an install under way, a probe', () => {
    expect(passes({ kind: 'installing' })).toBe(true)
    expect(passes({ kind: 'probing' })).toBe(true)
    expect(passes({ kind: 'notInstalled' })).toBe(false)
    expect(passes({ kind: 'installFailed', notice: { code: 'x' } } as never)).toBe(false)
  })
})

describe('trackerPackageOf', () => {
  const pkg = (name: string, over: Partial<PackageView>): PackageView => ({
    name, kind: 'plugin', installed: true, version: '1', latest: null, fetched: null, installing: false, error: null, note: null,
    default: false, settings: {}, servers: [], extras: false, removed: false, builtIn: false, ...over,
  })

  it('names the installed package that brings the server, not one still to install or removed', () => {
    const packages = [pkg('a', { servers: ['huly'], installed: false }), pkg('b', { servers: ['huly'], removed: true }), pkg('huly@even-keel', { servers: ['huly'] })]
    expect(trackerPackageOf(view({ packages }), 'huly')).toBe('huly@even-keel')
    expect(trackerPackageOf(view({ packages }), 'github')).toBeNull()
  })
})

describe('importOffers', () => {
  it('offers the servers of each chosen project that were not dismissed as they are', () => {
    const imports = { ABC: ['db', 'sentry'], DEMO: ['web'], XYZ: [] }
    expect(importOffers(view({ imports }), ['ABC', 'DEMO', 'XYZ'], { DEMO: 'web' })).toEqual([{ project: 'ABC', servers: ['db', 'sentry'] }])
  })

  it('offers again once the repository has a server the dismissal did not see', () => {
    expect(importOffers(view({ imports: { ABC: ['db', 'web'] } }), ['ABC'], { ABC: 'db' })).toEqual([{ project: 'ABC', servers: ['db', 'web'] }])
  })
})

describe('trackerPackage', () => {
  const marketplace = { name: 'even-keel', dir: 'C:\\even-keel', known: true }
  const base = { kind: 'plugin' as const, installed: true, version: '1.0.0', latest: null, fetched: null, installing: false, error: null, note: null, default: true, settings: {}, extras: true, removed: false, builtIn: false }
  const tracked = (brought: boolean, problems: ProjectPackages['problems'] = []): ProjectPackages => ({
    cells: { 'huly@even-keel': { choice: null, enabled: brought, own: {}, problems: [] } },
    problems,
    blocked: problems.length > 0,
    tracker: { server: 'huly', brought },
  })

  it('names the package that brings the tracker server', () => {
    const packages = [{ ...base, name: 'huly@even-keel', servers: ['huly'] }]
    expect(trackerPackage(view({ packages, projects: { ABC: tracked(true) } }), 'ABC')).toEqual({ state: 'brought', server: 'huly', by: 'huly@even-keel' })
  })

  it('names the tasks package when only it brings the tracker’s tasks, and offers no tracker package then', () => {
    const packages = [{ ...base, name: 'huly@even-keel', servers: ['huly'] }, { ...base, name: 'tasks@even-keel', servers: ['tasks'] }]
    const found: ProjectPackages = {
      cells: { 'huly@even-keel': { choice: 'off', enabled: false, own: {}, problems: [] }, 'tasks@even-keel': { choice: null, enabled: true, own: {}, problems: [] } },
      problems: [],
      blocked: false,
      tracker: { server: 'huly', brought: true, through: 'tasks' },
    }
    expect(trackerPackage(view({ packages, projects: { ABC: found } }), 'ABC')).toEqual({ state: 'brought', server: 'huly', by: 'tasks@even-keel' })
  })

  it('offers Even Keel’s plugin of the tracker while the catalog lacks it, and tells a problem from advice', () => {
    const available = [{ plugin: 'huly', marketplace: 'even-keel' }]
    expect(trackerPackage(view({ available, marketplace, projects: { ABC: tracked(false) } }), 'ABC')).toEqual({
      state: 'missing',
      server: 'huly',
      problem: false,
      choices: [{ server: 'huly', name: null, plugin: 'huly@even-keel' }],
    })
    const off = tracked(false, [{ kind: 'noTrackerMcp', server: 'huly' }])
    expect(trackerPackage(view({ available, marketplace, projects: { ABC: off } }), 'ABC')).toMatchObject({ problem: true })
  })

  it('offers the installed package to turn on, and nothing when there is no own marketplace', () => {
    const packages = [{ ...base, name: 'huly@even-keel', servers: ['huly'] }]
    expect(trackerPackage(view({ packages, marketplace, projects: { ABC: tracked(false) } }), 'ABC')).toMatchObject({ choices: [{ server: 'huly', name: 'huly@even-keel', plugin: null }] })
    const available = [{ plugin: 'huly', marketplace: 'even-keel' }]
    expect(trackerPackage(view({ available, projects: { ABC: tracked(false) } }), 'ABC')).toMatchObject({ choices: [] })
  })

  it('offers the tasks server first where it serves the tracker, the tracker’s own server beside it (BTN-874)', () => {
    const available = [{ plugin: 'huly', marketplace: 'even-keel' }, { plugin: 'tasks', marketplace: 'even-keel' }]
    const served = { ...tracked(false), tracker: { server: 'huly', brought: false, also: 'tasks' } }
    expect(trackerPackage(view({ available, marketplace, projects: { ABC: served } }), 'ABC')).toMatchObject({
      choices: [
        { server: 'tasks', name: null, plugin: 'tasks@even-keel' },
        { server: 'huly', name: null, plugin: 'huly@even-keel' },
      ],
    })
    const packages = [{ ...base, name: 'tasks@even-keel', servers: ['tasks'] }]
    expect(trackerPackage(view({ packages, available: available.slice(0, 1), marketplace, projects: { ABC: served } }), 'ABC')).toMatchObject({
      choices: [
        { server: 'tasks', name: 'tasks@even-keel', plugin: null },
        { server: 'huly', name: null, plugin: 'huly@even-keel' },
      ],
    })
  })

  it('has nothing to say for a tracker without a server or an unknown project', () => {
    expect(trackerPackage(view({ projects: { ABC: project(false) } }), 'ABC')).toBeNull()
    expect(trackerPackage(view(), 'ABC')).toBeNull()
  })
})

describe('trackerDoubled', () => {
  it('names both servers while the project’s sessions get both, nothing otherwise', () => {
    const both: ProjectPackages = { cells: {}, problems: [], blocked: false, tracker: { server: 'huly', brought: true, also: 'tasks', both: true } }
    expect(trackerDoubled(view({ projects: { ABC: both } }), 'ABC')).toEqual({ server: 'huly', also: 'tasks', by: null })
    const one: ProjectPackages = { ...both, tracker: { server: 'huly', brought: true, also: 'tasks' } }
    expect(trackerDoubled(view({ projects: { ABC: one } }), 'ABC')).toBeNull()
    expect(trackerDoubled(view(), 'ABC')).toBeNull()
  })

  it('names the enabled package that brings the tasks server, for one press to turn it off (BTN-1028)', () => {
    const base = { kind: 'plugin' as const, installed: true, version: '1.0.0', latest: null, fetched: null, installing: false, error: null, note: null, default: false, settings: {}, extras: true, removed: false, builtIn: false }
    const packages = [{ ...base, name: 'huly@even-keel', servers: ['huly'] }, { ...base, name: 'tasks@even-keel', servers: ['tasks'] }]
    const cell = { choice: 'on' as const, enabled: true, own: {}, problems: [] }
    const both: ProjectPackages = { cells: { 'huly@even-keel': cell, 'tasks@even-keel': cell }, problems: [], blocked: false, tracker: { server: 'huly', brought: true, also: 'tasks', both: true } }
    expect(trackerDoubled(view({ packages, projects: { ABC: both } }), 'ABC')).toEqual({ server: 'huly', also: 'tasks', by: 'tasks@even-keel' })
  })
})

describe('marketplaceCommand', () => {
  it('quotes the folder, which may hold spaces', () => {
    expect(marketplaceCommand('C:\\Program Files\\even-keel')).toBe('claude plugin marketplace add "C:\\Program Files\\even-keel"')
  })
})

describe('problemCount', () => {
  it('counts the problems of the enabled packages and of the set', () => {
    const projects = {
      ABC: {
        cells: {
          huly: { choice: null, enabled: true, own: {}, problems: [{ kind: 'noKey' as const, variables: ['HULY_PASSWORD'] }] },
          db: { choice: 'off' as const, enabled: false, own: {}, problems: [{ kind: 'notInstalled' as const }] },
        },
        problems: [{ kind: 'noTrackerMcp' as const, server: 'huly' }],
        blocked: true,
        tracker: { server: 'huly', brought: false },
      },
    }
    expect(problemCount(view({ projects }), 'ABC')).toBe(2)
    expect(problemCount(view({ projects }), 'XYZ')).toBe(0)
  })
})

describe('shownPackages', () => {
  it('keeps a removed package only while it is held, after the others', () => {
    const base = { kind: 'mcp' as const, installed: true, version: null, latest: null, fetched: null, installing: false, error: null, note: null, default: true, settings: {}, servers: [], extras: false, builtIn: false }
    const packages = [
      { ...base, name: 'old', removed: true },
      { ...base, name: 'web', removed: false },
      { ...base, name: 'db', removed: false },
    ]
    expect(shownPackages(view({ packages })).map((each) => each.name)).toEqual(['db', 'web', 'old'])
  })
})

describe('keyLabel', () => {
  it('takes the name the page knows for a variable', () => {
    expect(keyLabel('HULY_EMAIL', { HULY_EMAIL: 'The e-mail to sign in to Huly with' })).toBe('The e-mail to sign in to Huly with')
  })

  it('spells an unknown variable in words, abbreviations in capitals', () => {
    expect(keyLabel('SENTRY_AUTH_TOKEN', {})).toBe('Sentry auth token')
    expect(keyLabel('MY_API_URL', {})).toBe('My API URL')
  })
})
