import { describe, expect, it } from 'vitest'
import type { PackagesView, ProjectPackages } from '../../../src/state.js'
import { blockedProjects, importOffers, problemCount, serverEntry, shownPackages } from './packageView.js'

const project = (blocked: boolean, problems: ProjectPackages['problems'] = []): ProjectPackages => ({ cells: {}, problems, blocked })

const view = (over: Partial<PackagesView> = {}): PackagesView => ({
  gateway: null,
  packages: [],
  projects: {},
  keys: [],
  available: [],
  imports: {},
  ...over,
})

describe('serverEntry', () => {
  it('makes an address a url entry and anything else a command with its arguments', () => {
    expect(serverEntry(' https://mcp.example.com/mcp ')).toEqual({ type: 'http', url: 'https://mcp.example.com/mcp' })
    expect(serverEntry('npx -y @example/db-mcp@1')).toEqual({ command: 'npx', args: ['-y', '@example/db-mcp@1'] })
    expect(serverEntry('db-mcp')).toEqual({ command: 'db-mcp', args: [] })
  })

  it('gives nothing for an empty line', () => {
    expect(serverEntry('   ')).toBeNull()
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

describe('importOffers', () => {
  it('offers the servers of each chosen project that were not dismissed as they are', () => {
    const imports = { ABC: ['db', 'sentry'], DEMO: ['web'], XYZ: [] }
    expect(importOffers(view({ imports }), ['ABC', 'DEMO', 'XYZ'], { DEMO: 'web' })).toEqual([{ project: 'ABC', servers: ['db', 'sentry'] }])
  })

  it('offers again once the repository has a server the dismissal did not see', () => {
    expect(importOffers(view({ imports: { ABC: ['db', 'web'] } }), ['ABC'], { ABC: 'db' })).toEqual([{ project: 'ABC', servers: ['db', 'web'] }])
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
    const base = { kind: 'mcp' as const, installed: true, version: null, installing: false, error: null, note: null, default: true, settings: {}, servers: [], extras: false }
    const packages = [
      { ...base, name: 'old', removed: true },
      { ...base, name: 'web', removed: false },
      { ...base, name: 'db', removed: false },
    ]
    expect(shownPackages(view({ packages })).map((each) => each.name)).toEqual(['db', 'web', 'old'])
  })
})
