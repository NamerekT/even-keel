import { describe, expect, it } from 'vitest'
import type { Notice } from '../../../src/notice/notice.js'
import type { PackageCell, PackagesView, PackageView, ProjectPackages } from '../../../src/state.js'
import { catalogIssues, enabledPackages, isTrackerPlugin, looseKeys, marketplaceOf, packageGroups, packageKeys, packagesPath, projectGroups, projectIssues, shortName } from './packageGroups.js'

const base: PackageView = {
  name: '',
  kind: 'plugin',
  installed: true,
  version: '1.0.0',
  latest: null,
  fetched: null,
  installing: false,
  error: null,
  note: null,
  default: false,
  settings: {},
  servers: [],
  unpinned: [],
  scripts: null,
  extras: false,
  removed: false,
  builtIn: false,
}
const pkg = (name: string, over: Partial<PackageView> = {}): PackageView => ({ ...base, name, kind: name.includes('@') ? 'plugin' : 'mcp', ...over })
const cell = (enabled: boolean, over: Partial<PackageCell> = {}): PackageCell => ({ choice: null, enabled, own: {}, problems: [], ...over })
const project = (cells: Record<string, PackageCell>, over: Partial<ProjectPackages> = {}): ProjectPackages => ({ cells, problems: [], blocked: false, tracker: null, ...over })

const view = (over: Partial<PackagesView> = {}): PackagesView => ({
  gateway: null,
  packages: [],
  projects: {},
  keys: [],
  available: [],
  marketplace: { name: 'even-keel', dir: 'C:\\even-keel', known: true },
  imports: {},
  skills: { package: 'my-skills@even-keel-skills', list: [] },
  ...over,
})

describe('marketplaceOf and shortName', () => {
  it('splits a plugin at its last @ and leaves an MCP server whole', () => {
    expect(marketplaceOf(pkg('huly@even-keel'))).toBe('even-keel')
    expect(shortName(pkg('huly@even-keel'))).toBe('huly')
    expect(marketplaceOf(pkg('forgejo'))).toBeNull()
    expect(shortName(pkg('forgejo'))).toBe('forgejo')
  })
})

describe('packageGroups', () => {
  it('puts Even Keel first, the other marketplaces by name, MCP last, each by name with a removed one at its end', () => {
    const packages = [
      pkg('db'),
      pkg('playwright@claude-plugins-official'),
      pkg('my-skills@even-keel-skills'),
      pkg('old@even-keel', { removed: true }),
      pkg('linear@even-keel'),
      pkg('huly@even-keel'),
      pkg('design@acme'),
    ]
    const groups = packageGroups(packages, 'even-keel')
    expect(groups.map((group) => [group.kind, group.marketplace])).toEqual([
      ['own', 'even-keel'],
      ['marketplace', 'acme'],
      ['marketplace', 'claude-plugins-official'],
      ['marketplace', 'even-keel-skills'],
      ['mcp', null],
    ])
    expect(groups[0]!.packages.map((each) => each.name)).toEqual(['huly@even-keel', 'linear@even-keel', 'old@even-keel'])
  })

  it('has no own group without Even Keel’s marketplace, and no empty group', () => {
    expect(packageGroups([pkg('huly@even-keel')], null).map((group) => group.kind)).toEqual(['marketplace'])
    expect(packageGroups([], 'even-keel')).toEqual([])
  })
})

describe('isTrackerPlugin', () => {
  it('is a plugin of Even Keel’s marketplace named for a tracker’s server', () => {
    expect(isTrackerPlugin(pkg('huly@even-keel'), 'even-keel')).toBe(true)
    expect(isTrackerPlugin(pkg('agent-bridge@even-keel'), 'even-keel')).toBe(false)
    expect(isTrackerPlugin(pkg('github@claude-plugins-official'), 'even-keel')).toBe(false)
    expect(isTrackerPlugin(pkg('huly@even-keel'), null)).toBe(false)
  })
})

describe('projectGroups', () => {
  const packages = [pkg('huly@even-keel'), pkg('linear@even-keel'), pkg('github@even-keel'), pkg('agent-bridge@even-keel'), pkg('forgejo'), pkg('old', { removed: true })]

  it('shows the project’s tracker plugin and the enabled ones, folds the other trackers’ plugins and drops a removed package', () => {
    const projects = { ABC: project({ 'huly@even-keel': cell(false), 'linear@even-keel': cell(false), 'github@even-keel': cell(true), 'agent-bridge@even-keel': cell(false), forgejo: cell(true), old: cell(true) }, { tracker: { server: 'huly', brought: false } }) }
    const groups = projectGroups(view({ packages, projects }), 'ABC')
    expect(groups.map((group) => [group.kind, group.packages.map((each) => each.name), group.folded.map((each) => each.name)])).toEqual([
      ['own', ['agent-bridge@even-keel', 'github@even-keel', 'huly@even-keel'], ['linear@even-keel']],
      ['mcp', ['forgejo'], []],
    ])
  })

  it('keeps the tasks plugin in sight where it serves the tracker (BTN-874)', () => {
    const own = [...packages, pkg('tasks@even-keel')]
    const projects = { ABC: project({ 'huly@even-keel': cell(false), 'linear@even-keel': cell(false), 'tasks@even-keel': cell(false) }, { tracker: { server: 'huly', brought: false, also: 'tasks' } }) }
    expect(projectGroups(view({ packages: own, projects }), 'ABC')[0]).toMatchObject({ packages: [{ name: 'huly@even-keel' }, { name: 'tasks@even-keel' }], folded: [{ name: 'linear@even-keel' }] })
  })

  it('folds every tracker plugin that is off for a project without a tracker server', () => {
    const projects = { ABC: project({ 'huly@even-keel': cell(false), 'linear@even-keel': cell(false), 'github@even-keel': cell(false), 'agent-bridge@even-keel': cell(true), forgejo: cell(false) }) }
    expect(projectGroups(view({ packages, projects }), 'ABC')[0]).toMatchObject({ packages: [{ name: 'agent-bridge@even-keel' }], folded: [{ name: 'github@even-keel' }, { name: 'huly@even-keel' }, { name: 'linear@even-keel' }] })
  })

  it('shows nothing for a project the view does not know', () => {
    expect(projectGroups(view({ packages }), 'XYZ')).toEqual([])
  })
})

describe('projectIssues', () => {
  it('lists the set’s problems and those of the enabled packages, without what passes by itself or does not hold the chain', () => {
    const packages = [pkg('huly@even-keel', { servers: ['huly'] }), pkg('forgejo', { servers: ['forgejo'] }), pkg('db')]
    const projects = {
      ABC: project(
        {
          'huly@even-keel': cell(false, { problems: [{ kind: 'noKey', variables: ['HULY_PASSWORD'] }] }),
          forgejo: cell(true, { problems: [{ kind: 'noKey', variables: ['FORGEJO_TOKEN'] }, { kind: 'unsupported', agent: 'Codex' }] }),
          db: cell(true, { problems: [{ kind: 'probing' }] }),
        },
        { problems: [{ kind: 'noTrackerMcp', server: 'huly' }], tracker: { server: 'huly', brought: false } },
      ),
    }
    expect(projectIssues(view({ packages, projects }), 'ABC')).toEqual([
      { name: 'huly@even-keel', problem: { kind: 'noTrackerMcp', server: 'huly' } },
      { name: 'forgejo', problem: { kind: 'noKey', variables: ['FORGEJO_TOKEN'] } },
    ])
  })

  it('names the installed tasks package at the tracker’s problem where it serves the tracker (BTN-874)', () => {
    const packages = [pkg('huly@even-keel', { servers: ['huly'] }), pkg('tasks@even-keel', { servers: ['tasks'] })]
    const projects = {
      ABC: project(
        { 'huly@even-keel': cell(false), 'tasks@even-keel': cell(false) },
        { problems: [{ kind: 'noTrackerMcp', server: 'huly' }], tracker: { server: 'huly', brought: false, also: 'tasks' } },
      ),
    }
    expect(projectIssues(view({ packages, projects }), 'ABC')).toEqual([{ name: 'tasks@even-keel', problem: { kind: 'noTrackerMcp', server: 'huly' } }])
  })

  it('has no package for the tracker’s server the catalog lacks', () => {
    const projects = { ABC: project({}, { problems: [{ kind: 'noTrackerMcp', server: 'huly' }] }) }
    expect(projectIssues(view({ projects }), 'ABC')).toEqual([{ name: null, problem: { kind: 'noTrackerMcp', server: 'huly' } }])
  })
})

describe('enabledPackages', () => {
  it('lists the project’s enabled packages by name, without the ones off or removed', () => {
    const packages = [pkg('tasks@even-keel'), pkg('forgejo'), pkg('old@even-keel', { removed: true }), pkg('agent-bridge@even-keel'), pkg('idle@even-keel')]
    const projects = { ABC: project({ 'tasks@even-keel': cell(true), forgejo: cell(true), 'old@even-keel': cell(true), 'agent-bridge@even-keel': cell(true), 'idle@even-keel': cell(false) }) }
    expect(enabledPackages(view({ packages, projects }), 'ABC').map(shortName)).toEqual(['agent-bridge', 'forgejo', 'tasks'])
  })

  it('has none for a project the view does not know', () => {
    expect(enabledPackages(view({ packages: [pkg('forgejo')] }), 'XYZ')).toEqual([])
  })
})

describe('catalogIssues', () => {
  it('gathers each package’s problems over the projects it is on, once each, and a failed install', () => {
    const failed = { code: 'packages.installFailed', params: { name: 'db', error: 'exit 1' } } as unknown as Notice
    const packages = [pkg('forgejo'), pkg('db', { error: failed }), pkg('idle')]
    const missing = { kind: 'noKey' as const, variables: ['FORGEJO_TOKEN'] }
    const projects = {
      ABC: project({ forgejo: cell(true, { problems: [missing] }), idle: cell(false, { problems: [{ kind: 'notInstalled' }] }) }),
      XYZ: project({ forgejo: cell(true, { problems: [missing, { kind: 'probing' }] }) }),
    }
    expect(catalogIssues(view({ packages, projects }))).toEqual([
      { name: 'db', problem: { kind: 'installFailed', notice: failed } },
      { name: 'forgejo', problem: missing },
    ])
  })
})

describe('packageKeys and looseKeys', () => {
  it('tells the keys of a package from those only a tracker reads', () => {
    const keys = [
      { name: 'FORGEJO_TOKEN', set: true, packages: ['forgejo'] },
      { name: 'GITHUB_TOKEN', set: false, packages: [] },
    ]
    expect(packageKeys(view({ keys }), 'forgejo').map((each) => each.name)).toEqual(['FORGEJO_TOKEN'])
    expect(looseKeys(view({ keys })).map((each) => each.name)).toEqual(['GITHUB_TOKEN'])
  })
})

describe('packagesPath', () => {
  it('opens the project’s packages, with the add dialog on the plugin when there is one', () => {
    expect(packagesPath('A B')).toBe('/p/A%20B?pkg=1')
    expect(packagesPath('ABC', 'huly@even-keel')).toBe('/p/ABC?pkg=1&add=huly%40even-keel')
  })
})
