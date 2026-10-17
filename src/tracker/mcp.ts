import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { samePath } from '../paths.js'
import type { McpFailed, McpMissing } from '../state.js'

type Json = Record<string, unknown>

export interface McpPlugin {
  name: string
  servers: Json
}

/** Where the CLI takes MCP servers from for a project folder. */
export interface McpSources {
  /** `.claude.json` files: user scope at the top, local scope under `projects`. */
  configs: Json[]
  /** `.mcp.json` of the repository: project scope. */
  repoServers: Json
  /** Servers of the enabled plugins. */
  plugins: McpPlugin[]
}

export interface McpPlaces {
  claudeDir: string
  configs: string[]
}

export interface McpTarget {
  project: string
  repo: string
  server: string
  brief: boolean
}

export interface McpCheckDeps {
  /** Projects whose tracker has an MCP server. */
  targets: () => McpTarget[]
  read: (repo: string) => McpSources | undefined
  /** The CLI's cache of failed MCP servers in the account folder sessions start in. */
  failures: () => Json
  now: () => number
  warn: (line: string) => void
  onChange: () => void
}

/** How long the CLI skips a stdio plugin server that failed to start, when its entry names no `ttlMs` (CLI 2.1.302). */
const FAILURE_TTL_MS = 15 * 60_000
/** The CLI takes an entry up to a minute in the future as fresh: the clocks of two processes may differ. */
const CLOCK_SKEW_MS = 60_000

export class McpCheck {
  missing: McpMissing[] = []
  failed: McpFailed[] = []
  private readonly unreadable = new Set<string>()

  constructor(private readonly deps: McpCheckDeps) {}

  run(): void {
    const missing: McpMissing[] = []
    const failed: McpFailed[] = []
    const cache = this.deps.failures()
    for (const { project, repo, server, brief } of this.deps.targets()) {
      const sources = this.deps.read(repo)
      if (sources === undefined) {
        if (!brief && !this.unreadable.has(project)) this.deps.warn(`mcp: cannot tell whether sessions of ${project} see the "${server}" MCP server: no .claude.json to read`)
        this.unreadable.add(project)
        continue
      }
      const until = failedUntil(server, sources, cache, this.deps.now())
      if (until !== null) {
        const at = new Date(until).toISOString()
        failed.push({ project, server, until: at })
        if (!this.failed.some((each) => each.project === project && each.until === at)) {
          this.deps.warn(`mcp: sessions of ${project} wait until ${at}: the CLI cached the "${server}" MCP server as failed; check the tracker credentials in env of settings.json`)
        }
      }
      if (brief || mcpVisible(server, repo, sources)) continue
      missing.push({ project, server })
      if (!this.missing.some((each) => each.project === project)) {
        this.deps.warn(`mcp: brief is off for ${project}, but its sessions see no "${server}" MCP server: they get only the task id`)
      }
    }
    if (JSON.stringify({ missing, failed }) === JSON.stringify({ missing: this.missing, failed: this.failed })) return
    this.missing = missing
    this.failed = failed
    this.deps.onChange()
  }
}

/**
 * Until when a session skips `server` without trying it: the CLI caches a stdio plugin server that failed to start
 * under `plugin:<plugin>:<server>` and does not retry it for `ttlMs`. The entry's `id` is a hash of the server's
 * config the CLI compares with its own; it is not checked here (`docs/unverified.md`).
 */
export function failedUntil(server: string, sources: McpSources, cache: Json, now: number): number | null {
  const ends = sources.plugins
    .filter((plugin) => server in plugin.servers)
    .flatMap((plugin) => {
      const entry = objectOf(cache[`plugin:${plugin.name}:${server}`])
      if (typeof entry.timestamp !== 'number') return []
      const ttl = typeof entry.ttlMs === 'number' ? entry.ttlMs : FAILURE_TTL_MS
      const age = now - entry.timestamp
      return age > -CLOCK_SKEW_MS && age < ttl ? [entry.timestamp + ttl] : []
    })
  return ends.length === 0 ? null : Math.max(...ends)
}

export function readFailures(claudeDir: string): Json {
  return readJson(join(claudeDir, 'mcp-needs-auth-cache.json')) ?? {}
}

export function mcpVisible(server: string, repo: string, sources: McpSources, platform: NodeJS.Platform = process.platform): boolean {
  const projects = sources.configs.flatMap((config) =>
    Object.entries(objectOf(config.projects))
      .filter(([path]) => samePath(path, repo, platform))
      .map(([, project]) => objectOf(project)),
  )
  const listedIn = (key: string, name: string) => projects.some((project) => listOf(project[key]).includes(name))
  const declared = sources.configs.some((config) => server in objectOf(config.mcpServers)) || projects.some((project) => server in objectOf(project.mcpServers))
  if (declared && !listedIn('disabledMcpServers', server)) return true
  if (server in sources.repoServers && !listedIn('disabledMcpjsonServers', server)) return true
  return sources.plugins.some((plugin) => server in plugin.servers && !listedIn('disabledMcpServers', `plugin:${plugin.name}:${server}`))
}

/** `undefined` when none of the `.claude.json` files can be read: then nothing can be said. */
export function readMcpSources(repo: string, places: McpPlaces): McpSources | undefined {
  const configs = places.configs.map(readJson).filter((config): config is Json => config !== undefined)
  if (configs.length === 0) return undefined
  const settings = [join(places.claudeDir, 'settings.json'), join(repo, '.claude', 'settings.json'), join(repo, '.claude', 'settings.local.json')]
  const enabled: Json = Object.assign({}, ...settings.map((file) => objectOf(readJson(file)?.enabledPlugins)))
  const installed = objectOf(readJson(join(places.claudeDir, 'plugins', 'installed_plugins.json'))?.plugins)
  const plugins = Object.keys(enabled)
    .filter((key) => enabled[key] === true)
    .flatMap((key) => {
      const install = listOf(installed[key]).map(objectOf)[0]?.installPath
      return typeof install === 'string' ? [pluginServers(key, install)] : []
    })
    .filter((plugin) => Object.keys(plugin.servers).length > 0)
  return { configs, repoServers: serversIn(readJson(join(repo, '.mcp.json'))), plugins }
}

function pluginServers(key: string, dir: string): McpPlugin {
  const manifest = readJson(join(dir, '.claude-plugin', 'plugin.json'))
  const declared = manifest?.mcpServers
  const fromManifest = typeof declared === 'string' ? serversIn(readJson(resolve(dir, declared))) : objectOf(declared)
  const name = typeof manifest?.name === 'string' ? manifest.name : key.split('@')[0]!
  return { name, servers: { ...serversIn(readJson(join(dir, '.mcp.json'))), ...fromManifest } }
}

export function serversIn(file: Json | undefined): Json {
  if (file === undefined) return {}
  return 'mcpServers' in file ? objectOf(file.mcpServers) : file
}

function readJson(file: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
  } catch {
    return undefined
  }
}

function objectOf(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
