import { pluginReach } from '../agent/projectRules.js'
import type { Notice } from '../notice/notice.js'
import type { PackageCell, PackageProblem, ProjectPackages } from '../state.js'
import type { ServerKeys } from './keys.js'
import { current, enabledIn, settingsOf, type PackagesFile, type ServerEntry } from './model.js'

const PROBE_OK_MS = 5 * 60_000
/** The wait before asking a failing server again, by its failures in a row; the last one repeats (BTN-589). */
const PROBE_FAILED_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000]
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
  /** Whether the server answered `initialize` through the gateway; `undefined` — not probed yet or still starting, held until it answers. */
  probe: (name: string, install: string, server: string) => boolean | undefined
  /** The tracker's MCP server; `required` — `brief` is off, so a session cannot do without it. */
  tracker?: { server: string; required: boolean }
}

/** Whether a package the project's sessions get brings the server; `brief` left to itself is on exactly when none does. */
export function bringsServer(file: PackagesFile, project: string, server: string): boolean {
  return Object.entries(file.packages).some(([name, record]) => enabledIn(file, project, name) && current(record)?.servers[server] !== undefined)
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
        let probing = false
        for (const [server, { entry }] of Object.entries(install.servers)) {
          if (server === input.tracker?.server) hasTracker = true
          const keys = input.keys(server, entry)
          keys.missing.forEach((each) => missing.add(each))
          if (keys.missing.length > 0) continue
          const answered = input.probe(name, install.id, server)
          if (answered === false) silent.push(server)
          else if (answered === undefined) probing = true
        }
        if (missing.size > 0) problems.push({ kind: 'noKey', variables: [...missing] })
        if (silent.length > 0) problems.push({ kind: 'noResponse', servers: silent })
        if (probing) problems.push({ kind: 'probing' })
        const reach = pluginReach(input.agent)
        if (install.extras && record.kind === 'plugin' && reach !== 'all') {
          problems.push(reach === 'skills' ? { kind: 'unsupported', agent: input.agent, skills: true } : { kind: 'unsupported', agent: input.agent })
        }
      }
    }
    cells[name] = { choice, enabled, settings, problems }
  }
  const tracker = input.tracker === undefined ? null : { server: input.tracker.server, brought: hasTracker }
  const problems: PackageProblem[] = tracker !== null && input.tracker?.required === true && !hasTracker ? [{ kind: 'noTrackerMcp', server: tracker.server }] : []
  const blocked = [...problems, ...Object.values(cells).flatMap((cell) => cell.problems)].some((problem) => !NOTES.has(problem.kind))
  return { cells, problems, blocked, tracker }
}

/**
 * `initialize` through the gateway, the way a session opens a server: a good answer holds for 5 minutes, a failed one
 * is asked again after 30 seconds, then less and less often up to once an hour. Silence before the server's first answer
 * is a start that takes long (a cold `npx`), not a failure: it stays `undefined`, asked again at once, until the server
 * answers or the gateway says it is gone.
 */
export class Probes {
  private readonly results = new Map<string, { ok: boolean | undefined; at: number; failures: number }>()
  private readonly answered = new Set<string>()
  private readonly running = new Set<string>()

  constructor(
    private readonly deps: {
      urlOf: (project: string, name: string, install: string, server: string) => string
      now: () => number
      /** A result changed. */
      onChange: () => void
      timeoutMs?: number
    },
  ) {}

  /** The last result; starts a probe when there is none or it is old. */
  result(project: string, name: string, install: string, server: string): boolean | undefined {
    const key = `${name}\u0000${install}\u0000${server}`
    const known = this.results.get(key)
    const wait = known?.ok ? PROBE_OK_MS : PROBE_FAILED_MS[Math.max(0, Math.min((known?.failures ?? 0) - 1, PROBE_FAILED_MS.length - 1))]!
    const stale = known === undefined || known.ok === undefined || this.deps.now() - known.at > wait
    if (stale && !this.running.has(key)) void this.run(key, this.deps.urlOf(project, name, install, server))
    return known?.ok
  }

  forget(name: string): void {
    for (const key of this.results.keys()) if (key.startsWith(`${name}\u0000`)) this.results.delete(key)
    for (const key of this.answered) if (key.startsWith(`${name}\u0000`)) this.answered.delete(key)
  }

  /** Something a failing server needs may have changed (a profile saved, a new grant): ask each one again at once. */
  retry(): void {
    for (const [key, known] of this.results) if (known.ok === false) this.results.set(key, { ...known, at: -Infinity, failures: 0 })
  }

  private async run(key: string, url: string): Promise<void> {
    this.running.add(key)
    const outcome = await probe(url, this.deps.timeoutMs ?? PROBE_TIMEOUT_MS)
    this.running.delete(key)
    if (outcome === 'ok') this.answered.add(key)
    const ok = outcome === 'silent' && !this.answered.has(key) ? undefined : outcome === 'ok'
    const before = this.results.get(key)
    this.results.set(key, { ok, at: this.deps.now(), failures: ok === false ? (before?.failures ?? 0) + 1 : 0 })
    if (before?.ok !== ok) this.deps.onChange()
  }
}

async function probe(url: string, timeoutMs: number): Promise<'ok' | 'failed' | 'silent'> {
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
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    const session = response.headers.get('mcp-session-id')
    if (session !== null) void fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': session } }).catch(() => {})
    return response.ok && text.includes('"result"') ? 'ok' : 'failed'
  } catch (error) {
    return (error as Error).name === 'TimeoutError' ? 'silent' : 'failed'
  }
}
