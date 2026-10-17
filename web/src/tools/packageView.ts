import type { PackagesView, PackageView } from '../../../src/state.js'

/** What the "MCP server" field holds: an address is an HTTP server, anything else a command and its arguments. */
export function serverEntry(text: string): Record<string, unknown> | null {
  const line = text.trim()
  if (line === '') return null
  if (/^https?:\/\//i.test(line)) return { type: 'http', url: line }
  const [command, ...args] = line.split(/\s+/)
  return { command, args }
}

export function blockedProjects(view: PackagesView, projects: string[]): string[] {
  return projects.filter((project) => view.projects[project]?.blocked === true)
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
