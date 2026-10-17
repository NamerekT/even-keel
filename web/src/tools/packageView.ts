import type { PackageProblem, PackagesView, PackageView } from '../../../src/state.js'

/** What the "MCP server" field holds: an address is an HTTP server, anything else a command and its arguments. */
export function serverEntry(text: string): Record<string, unknown> | null {
  const line = text.trim()
  if (line === '') return null
  if (/^https?:\/\//i.test(line)) return { type: 'http', url: line }
  const [command, ...args] = line.split(/\s+/)
  return { command, args }
}

/** Hold the chain for a moment after an install: not worth the banner, which would come and go. */
const PASSING = new Set<PackageProblem['kind']>(['installing', 'probing'])

/** The projects the banner names: held by their packages, not only for a moment. */
export function blockedProjects(view: PackagesView, projects: string[]): string[] {
  return projects.filter((project) => {
    const found = view.projects[project]
    if (found?.blocked !== true) return false
    const problems = [...found.problems, ...Object.values(found.cells).flatMap((cell) => (cell.enabled ? cell.problems : []))].filter((each) => each.kind !== 'unsupported')
    return problems.length === 0 || problems.some((each) => !PASSING.has(each.kind))
  })
}

/** By project: the servers it was offered as they were when dismissed, joined by a comma. */
export type Dismissed = Record<string, string>

export function importOffers(view: PackagesView, projects: string[], dismissed: Dismissed): { project: string; servers: string[] }[] {
  return projects.flatMap((project) => {
    const servers = view.imports[project] ?? []
    return servers.length === 0 || dismissed[project] === servers.join(',') ? [] : [{ project, servers }]
  })
}

/** The problems that reach the project's sessions: of its enabled packages and of the set as a whole. */
export function problemCount(view: PackagesView, project: string): number {
  const found = view.projects[project]
  if (found === undefined) return 0
  return found.problems.length + Object.values(found.cells).reduce((sum, cell) => sum + (cell.enabled ? cell.problems.length : 0), 0)
}

/** By name, a removed package that a running task still holds at the end. */
export function shownPackages(view: PackagesView): PackageView[] {
  return [...view.packages].sort((a, b) => Number(a.removed) - Number(b.removed) || a.name.localeCompare(b.name))
}
