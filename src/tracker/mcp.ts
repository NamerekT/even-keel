import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { samePath } from '../paths.js'
import type { McpMissing } from '../state.js'

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
}

export interface McpCheckDeps {
  /** Projects with `brief` off whose tracker has an MCP server. */
  targets: () => McpTarget[]
  read: (repo: string) => McpSources | undefined
  warn: (line: string) => void
  onChange: () => void
}

export class McpCheck {
  missing: McpMissing[] = []
  private readonly unreadable = new Set<string>()

  constructor(private readonly deps: McpCheckDeps) {}

  run(): void {
    const next: McpMissing[] = []
    for (const { project, repo, server } of this.deps.targets()) {
      const sources = this.deps.read(repo)
      if (sources === undefined) {
        if (!this.unreadable.has(project)) this.deps.warn(`mcp: cannot tell whether sessions of ${project} see the "${server}" MCP server: no .claude.json to read`)
        this.unreadable.add(project)
        continue
      }
      if (mcpVisible(server, repo, sources)) continue
      next.push({ project, server })
      if (!this.missing.some((each) => each.project === project)) {
        this.deps.warn(`mcp: brief is off for ${project}, but its sessions see no "${server}" MCP server: they get only the task id`)
      }
    }
    if (JSON.stringify(next) === JSON.stringify(this.missing)) return
    this.missing = next
    this.deps.onChange()
  }
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

function serversIn(file: Json | undefined): Json {
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
