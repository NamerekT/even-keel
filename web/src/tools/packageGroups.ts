import type { KeyView, PackageProblem, PackagesView, PackageView } from '../../../src/state.js'
import { projectPath } from '../state.js'
import { shownPackages, trackerPackage } from './packageView.js'
import { TRACKER_SERVERS } from './trackerServers.js'

/** The marketplace of a plugin (after its last `@`); `null` for an MCP server. */
export function marketplaceOf(pkg: PackageView): string | null {
  if (pkg.kind === 'mcp') return null
  const at = pkg.name.lastIndexOf('@')
  return at < 0 ? '' : pkg.name.slice(at + 1)
}

/** The name without its marketplace, which the group's head says once. */
export function shortName(pkg: PackageView): string {
  const at = pkg.name.lastIndexOf('@')
  return pkg.kind === 'mcp' || at < 0 ? pkg.name : pkg.name.slice(0, at)
}

export interface PackageGroup {
  /** `own` — Even Keel's marketplace. */
  kind: 'own' | 'marketplace' | 'mcp'
  marketplace: string | null
  packages: PackageView[]
}

/** By source: Even Keel's own plugins, then the other marketplaces by name, MCP servers last; no empty group. */
export function packageGroups(packages: PackageView[], own: string | null): PackageGroup[] {
  const sorted = shownPackages({ packages } as PackagesView)
  const by = new Map<string, PackageView[]>()
  for (const each of sorted) {
    const key = marketplaceOf(each) ?? '\u0000mcp'
    by.set(key, [...(by.get(key) ?? []), each])
  }
  const marketplaces = [...by.keys()].filter((key) => key !== '\u0000mcp' && key !== own).sort((a, b) => a.localeCompare(b))
  return [
    ...(own !== null && by.has(own) ? [{ kind: 'own' as const, marketplace: own, packages: by.get(own)! }] : []),
    ...marketplaces.map((marketplace) => ({ kind: 'marketplace' as const, marketplace, packages: by.get(marketplace)! })),
    ...(by.has('\u0000mcp') ? [{ kind: 'mcp' as const, marketplace: null, packages: by.get('\u0000mcp')! }] : []),
  ]
}

/** One of Even Keel's tracker plugins: a project needs only its own tracker's. */
export function isTrackerPlugin(pkg: PackageView, own: string | null): boolean {
  return own !== null && marketplaceOf(pkg) === own && (TRACKER_SERVERS as readonly string[]).includes(shortName(pkg))
}

export interface ProjectGroup extends PackageGroup {
  /** The other trackers' plugins the project has off: under "N more". */
  folded: PackageView[]
}

/** A project's packages by group: its tracker's plugins and the enabled ones shown, the rest of the tracker plugins folded. */
export function projectGroups(view: PackagesView, project: string): ProjectGroup[] {
  const found = view.projects[project]
  if (found === undefined) return []
  const own = view.marketplace?.name ?? null
  // The tasks server stays in sight too where it serves the tracker: it is the default choice (BTN-874).
  const servers = [found.tracker?.server, found.tracker?.also]
  const live = view.packages.filter((each) => !each.removed && found.cells[each.name] !== undefined)
  return packageGroups(live, own).map((group) => {
    const folds = (each: PackageView) => isTrackerPlugin(each, own) && !servers.includes(shortName(each)) && found.cells[each.name]?.enabled !== true
    return { ...group, packages: group.packages.filter((each) => !folds(each)), folded: group.packages.filter(folds) }
  })
}

/** The packages a project's sessions get, by name: what the button to its packages lists (BTN-914). */
export function enabledPackages(view: PackagesView, project: string): PackageView[] {
  const cells = view.projects[project]?.cells
  if (cells === undefined) return []
  return shownPackages(view).filter((each) => !each.removed && cells[each.name]?.enabled === true)
}

/** A problem and the package it is fixed at; `null` — the catalog has no package for it yet. */
export interface PackageIssue {
  name: string | null
  problem: PackageProblem
}

/** Pass by themselves or do not hold the chain: they stay on their row, not in the list above. */
const QUIET = new Set<PackageProblem['kind']>(['probing', 'unsupported'])

/** What the project's chain waits on: the set's problems, then those of its enabled packages. */
export function projectIssues(view: PackagesView, project: string): PackageIssue[] {
  const found = view.projects[project]
  if (found === undefined) return []
  const tracker = trackerPackage(view, project)
  const first = tracker?.state === 'missing' ? (tracker.choices[0]?.name ?? null) : null
  const set = found.problems.map((problem) => ({ name: problem.kind === 'noTrackerMcp' ? first : null, problem }))
  const cells = view.packages.flatMap((each) => {
    const cell = found.cells[each.name]
    return cell?.enabled === true && !each.removed ? cell.problems.filter((problem) => !QUIET.has(problem.kind)).map((problem) => ({ name: each.name, problem })) : []
  })
  return [...set, ...cells]
}

/** Each package's problems over the projects that have it on, once each, and a failed install even where none has. */
export function catalogIssues(view: PackagesView): PackageIssue[] {
  return shownPackages(view).flatMap((each) => {
    if (each.removed) return []
    const seen = new Map<string, PackageProblem>()
    if (each.error !== null) seen.set('installFailed', { kind: 'installFailed', notice: each.error })
    for (const found of Object.values(view.projects)) {
      const cell = found.cells[each.name]
      if (cell?.enabled !== true) continue
      for (const problem of cell.problems) if (!QUIET.has(problem.kind)) seen.set(problem.kind === 'installFailed' ? 'installFailed' : JSON.stringify(problem), problem)
    }
    return [...seen.values()].map((problem) => ({ name: each.name, problem }))
  })
}

/** The keys a package's servers read: they stand in its row's details. */
export function packageKeys(view: PackagesView, name: string): KeyView[] {
  return view.keys.filter((key) => key.packages.includes(name))
}

/** The keys no package reads, only a tracker's server. */
export function looseKeys(view: PackagesView): KeyView[] {
  return view.keys.filter((key) => key.packages.length === 0)
}

/** The address parameter that opens a project's packages over its page; `add` opens the add dialog over them on a plugin. */
export const PACKAGES_PARAM = 'pkg'
export const ADD_PARAM = 'add'
/** `/settings?package=<name>`: the catalog with that package's details open, as a project's packages link to it. */
export const PACKAGE_PARAM = 'package'

/** The project's page with its packages open, and the add dialog on the plugin when there is one. */
export function packagesPath(project: string, plugin: string | null = null): string {
  const path = `${projectPath(project)}?${PACKAGES_PARAM}=1`
  return plugin === null ? path : `${path}&${ADD_PARAM}=${encodeURIComponent(plugin)}`
}
