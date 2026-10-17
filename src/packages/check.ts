import type { Notice } from '../notice/notice.js'
import type { PackageCell, PackageProblem, ProjectPackages } from '../state.js'
import type { ServerKeys } from './keys.js'
import { current, enabledIn, settingsOf, type PackagesFile, type ServerEntry } from './model.js'

const PROBE_OK_MS = 5 * 60_000
const PROBE_FAILED_MS = 30_000
const PROBE_TIMEOUT_MS = 30_000

/** Does not hold the chain. */
const NOTES = new Set<PackageProblem['kind']>(['unsupported'])

export interface CheckInput {
  file: PackagesFile
  /** The project's id. */
  project: string
  /** The agent of the account the project's sessions run on. */
  agent: string
  /** Packages being installed or updated now. */
  installing: ReadonlySet<string>
  /** The failure of each package's last install. */
  errors: ReadonlyMap<string, Notice>
  keys: (server: string, entry: ServerEntry) => ServerKeys
  /** Whether the server answered `initialize` through the gateway; `undefined` — not probed yet, not held for it. */
  probe: (name: string, install: string, server: string) => boolean | undefined
  /** The tracker's MCP server a session of a project with `brief` off cannot do without. */
  trackerServer?: string
}

/** The project's cells and problems for its next session: the current install of each package its set has. */
export function projectPackages(input: CheckInput): ProjectPackages {
  const { file, project } = input
  const set = file.projects[project]
  const cells: Record<string, PackageCell> = {}
  let hasTracker = false
  for (const [name, record] of Object.entries(file.packages)) {
    if (record.removed === true) continue
    const enabled = enabledIn(file, project, name)
    const choice = set?.on.includes(name) ? 'on' : set?.off.includes(name) ? 'off' : null
    const settings = settingsOf(file, project, name)
    const problems: PackageProblem[] = []
    const install = current(record)
    if (enabled) {
      if (input.installing.has(name)) problems.push({ kind: 'installing' })
      else if (install === undefined) {
        const error = input.errors.get(name)
        problems.push(error === undefined ? { kind: 'notInstalled' } : { kind: 'installFailed', notice: error })
      }
      if (install !== undefined) {
        const missing = new Set<string>()
        const silent: string[] = []
        for (const [server, { entry }] of Object.entries(install.servers)) {
          if (server === input.trackerServer) hasTracker = true
          const keys = input.keys(server, entry)
          keys.missing.forEach((each) => missing.add(each))
          if (keys.missing.length === 0 && input.probe(name, install.id, server) === false) silent.push(server)
        }
        if (missing.size > 0) problems.push({ kind: 'noKey', variables: [...missing] })
        if (silent.length > 0) problems.push({ kind: 'noResponse', servers: silent })
        if (install.extras && record.kind === 'plugin' && input.agent !== 'claude') problems.push({ kind: 'unsupported', agent: input.agent })
      }
    }
    cells[name] = { choice, enabled, settings, problems }
  }
  const problems: PackageProblem[] = input.trackerServer !== undefined && !hasTracker ? [{ kind: 'noTrackerMcp', server: input.trackerServer }] : []
  const blocked = [...problems, ...Object.values(cells).flatMap((cell) => cell.problems)].some((problem) => !NOTES.has(problem.kind))
  return { cells, problems, blocked }
}

/**
 * `initialize` through the gateway, the way a session opens a server: a good answer holds for 5 minutes, a failed one
 * is asked again after 30 seconds.
 */
export class Probes {
  private readonly results = new Map<string, { ok: boolean; at: number }>()
  private readonly running = new Set<string>()

  constructor(
    private readonly deps: {
      urlOf: (project: string, name: string, install: string, server: string) => string
      now: () => number
      /** A result changed. */
      onChange: () => void
    },
  ) {}

  /** The last result; starts a probe when there is none or it is old. */
  result(project: string, name: string, install: string, server: string): boolean | undefined {
    const key = `${name}\u0000${install}\u0000${server}`
    const known = this.results.get(key)
    const stale = known === undefined || this.deps.now() - known.at > (known.ok ? PROBE_OK_MS : PROBE_FAILED_MS)
    if (stale && !this.running.has(key)) void this.run(key, this.deps.urlOf(project, name, install, server))
    return known?.ok
  }

  forget(name: string): void {
    for (const key of this.results.keys()) if (key.startsWith(`${name}\u0000`)) this.results.delete(key)
  }

  private async run(key: string, url: string): Promise<void> {
    this.running.add(key)
    const ok = await probe(url)
    this.running.delete(key)
    const before = this.results.get(key)?.ok
    this.results.set(key, { ok, at: this.deps.now() })
    if (before !== ok) this.deps.onChange()
  }
}

async function probe(url: string): Promise<boolean> {
  const initialize = {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'even-keel-probe', version: '1' } },
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(initialize),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const text = await response.text()
    const session = response.headers.get('mcp-session-id')
    if (session !== null) void fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': session } }).catch(() => {})
    return response.ok && text.includes('"result"')
  } catch {
    return false
  }
}
