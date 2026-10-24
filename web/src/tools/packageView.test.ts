import { describe, expect, it } from 'vitest'
import type { PackagesView, ProjectPackages } from '../../../src/state.js'
import { blockedProjects, heldFor, importOffers, keyLabel, marketplaceCommand, problemCount, serverEntry, shownPackages, trackerAddPath, trackerPackage } from './packageView.js'

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

describe('blockedProjects', () => {
  it('names the held projects in the order of the config', () => {
    const projects = { XYZ: project(true), ABC: project(true), DEMO: project(false) }
    expect(blockedProjects(view({ projects }), ['ABC', 'DEMO', 'XYZ'])).toEqual(['ABC', 'XYZ'])
  })

  it('leaves out a project held only while a package installs or is probed: the banner would blink', () => {
    const cell = (enabled: boolean, problems: ProjectPackages['problems']) => ({ choice: null, enabled, settings: {}, problems })
    const held = (cells: ProjectPackages['cells']): ProjectPackages => ({ cells, problems: [], blocked: true, tracker: null })
    const projects = {
      ABC: held({ a: cell(true, [{ kind: 'installing' }]), b: cell(true, [{ kind: 'probing' }]), c: cell(false, [{ kind: 'notInstalled' }]) }),
      XYZ: held({ a: cell(true, [{ kind: 'probing' }]), b: cell(true, [{ kind: 'noResponse', servers: ['b'] }]) }),
    }
    expect(blockedProjects(view({ projects }), ['ABC', 'XYZ'])).toEqual(['XYZ'])
  })
})

describe('heldFor', () => {
  it('groups the held projects that lack the tracker server by the server, the others together', () => {
    const projects = {
      ABC: project(true, [{ kind: 'noTrackerMcp', server: 'huly' }]),
      XYZ: project(true),
      DEMO: project(true, [{ kind: 'noTrackerMcp', server: 'huly' }]),
      GH: project(true, [{ kind: 'noTrackerMcp', server: 'github' }]),
    }
    expect(heldFor(view({ projects }), ['ABC', 'XYZ', 'DEMO', 'GH'])).toEqual([
      { server: 'huly', projects: ['ABC', 'DEMO'] },
      { server: null, projects: ['XYZ'] },
      { server: 'github', projects: ['GH'] },
    ])
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
  const base = { kind: 'plugin' as const, installed: true, version: '1.0.0', latest: null, fetched: null, installing: false, error: null, note: null, default: true, settings: {}, extras: true, removed: false }
  const tracked = (brought: boolean, problems: ProjectPackages['problems'] = []): ProjectPackages => ({
    cells: { 'huly@even-keel': { choice: null, enabled: brought, settings: {}, problems: [] } },
    problems,
    blocked: problems.length > 0,
    tracker: { server: 'huly', brought },
  })

  it('names the package that brings the tracker server', () => {
    const packages = [{ ...base, name: 'huly@even-keel', servers: ['huly'] }]
    expect(trackerPackage(view({ packages, projects: { ABC: tracked(true) } }), 'ABC')).toEqual({ state: 'brought', server: 'huly', by: 'huly@even-keel' })
  })

  it('offers Even Keel’s plugin of the tracker while the catalog lacks it, and tells a problem from advice', () => {
    const available = [{ plugin: 'huly', marketplace: 'even-keel' }]
    expect(trackerPackage(view({ available, marketplace, projects: { ABC: tracked(false) } }), 'ABC')).toEqual({ state: 'missing', server: 'huly', problem: false, plugin: 'huly@even-keel' })
    const off = tracked(false, [{ kind: 'noTrackerMcp', server: 'huly' }])
    expect(trackerPackage(view({ available, marketplace, projects: { ABC: off } }), 'ABC')).toMatchObject({ problem: true })
  })

  it('offers no plugin when the catalog has it already or there is no own marketplace', () => {
    expect(trackerPackage(view({ marketplace, projects: { ABC: tracked(false) } }), 'ABC')).toMatchObject({ state: 'missing', plugin: null })
    const available = [{ plugin: 'huly', marketplace: 'even-keel' }]
    expect(trackerPackage(view({ available, projects: { ABC: tracked(false) } }), 'ABC')).toMatchObject({ plugin: null })
  })

  it('has nothing to say for a tracker without a server or an unknown project', () => {
    expect(trackerPackage(view({ projects: { ABC: project(false) } }), 'ABC')).toBeNull()
    expect(trackerPackage(view(), 'ABC')).toBeNull()
  })
})

describe('trackerAddPath', () => {
  it('opens the project on /tools, with the add dialog on the plugin when there is one', () => {
    expect(trackerAddPath('A B', 'huly@even-keel')).toBe('/tools?projects=A%20B&add=huly%40even-keel')
    expect(trackerAddPath('ABC', null)).toBe('/tools?projects=ABC')
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
          huly: { choice: null, enabled: true, settings: {}, problems: [{ kind: 'noKey' as const, variables: ['HULY_PASSWORD'] }] },
          db: { choice: 'off' as const, enabled: false, settings: {}, problems: [{ kind: 'notInstalled' as const }] },
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
    const base = { kind: 'mcp' as const, installed: true, version: null, latest: null, fetched: null, installing: false, error: null, note: null, default: true, settings: {}, servers: [], extras: false }
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
