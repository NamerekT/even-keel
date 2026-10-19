import { describe, expect, it } from 'vitest'
import type { PackagesView, ProjectPackages } from '../../../src/state.js'
import { blockedProjects, heldFor, importOffers, marketplaceCommand, problemCount, serverEntry, shownPackages } from './packageView.js'

const project = (blocked: boolean, problems: ProjectPackages['problems'] = []): ProjectPackages => ({ cells: {}, problems, blocked })

const view = (over: Partial<PackagesView> = {}): PackagesView => ({
  gateway: null,
  packages: [],
  projects: {},
  keys: [],
  available: [],
  marketplace: null,
  imports: {},
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
    const held = (cells: ProjectPackages['cells']): ProjectPackages => ({ cells, problems: [], blocked: true })
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
