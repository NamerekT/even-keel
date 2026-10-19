import type { PackageProblem, PackagesView, PackageView } from '../../../src/state.js'

export type Transport = 'http' | 'stdio'

const WORD = /"([^"]*)"|'([^']*)'|(\S+)/g
const HEADER = /^[\w!#$%&'*+.^`|~-]+$/
const VARIABLE = /^[A-Za-z_]\w*$/

/**
 * The entry of an MCP server from the add dialog: an address with its headers (`Name: value` lines), or a command with
 * its environment (`NAME=value` lines), split into arguments with a quoted one kept whole. `null` while anything is wrong.
 */
export function serverEntry(transport: Transport, target: string, lines: string): Record<string, unknown> | null {
  const line = target.trim()
  const pairs = serverPairs(transport, lines)
  if (line === '' || pairs === null) return null
  const extra = Object.keys(pairs).length === 0 ? {} : { [transport === 'http' ? 'headers' : 'env']: pairs }
  if (transport === 'http') return /^https?:\/\/\S+$/i.test(line) ? { type: 'http', url: line, ...extra } : null
  const [command, ...args] = [...line.matchAll(WORD)].map((match) => match[1] ?? match[2] ?? match[3]!)
  return { command, args, ...extra }
}

/** The headers or the environment lines; `null` when a line is not `Name: value` or `NAME=value`. */
export function serverPairs(transport: Transport, text: string): Record<string, string> | null {
  const [separator, name] = transport === 'http' ? [':', HEADER] : ['=', VARIABLE]
  const pairs: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const at = line.indexOf(separator)
    const key = line.slice(0, at).trim()
    if (at < 0 || !name.test(key)) return null
    pairs[key] = line.slice(at + 1).trim()
  }
  return pairs
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

/**
 * The held projects by reason for the banner: those with `brief` off and no package bringing the tracker's server, by
 * the server (`noTrackerMcp`), and the rest under `null`; groups in the order of their first project.
 */
export function heldFor(view: PackagesView, blocked: string[]): { server: string | null; projects: string[] }[] {
  const groups: { server: string | null; projects: string[] }[] = []
  for (const project of blocked) {
    const missing = view.projects[project]?.problems.find((each) => each.kind === 'noTrackerMcp')
    const server = missing?.kind === 'noTrackerMcp' ? missing.server : null
    const group = groups.find((each) => each.server === server)
    if (group === undefined) groups.push({ server, projects: [project] })
    else group.projects.push(project)
  }
  return groups
}

/** By project: the servers it was offered as they were when dismissed, joined by a comma. */
export type Dismissed = Record<string, string>

export function importOffers(view: PackagesView, projects: string[], dismissed: Dismissed): { project: string; servers: string[] }[] {
  return projects.flatMap((project) => {
    const servers = view.imports[project] ?? []
    return servers.length === 0 || dismissed[project] === servers.join(',') ? [] : [{ project, servers }]
  })
}

/** What the "Add to Claude Code" button runs, for a terminal of the user's own. */
export function marketplaceCommand(dir: string): string {
  return `claude plugin marketplace add "${dir}"`
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
