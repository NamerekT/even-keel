import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gatewayName, type SessionMcp, type SessionPlugin } from '../agent/contract.js'
import { isTasksUrl } from '../taskmcp/server.js'
import { isMemoryUrl } from '../memory/mcp.js'
import { current, enabledPackages, installsFor, pluginKey, type PackageInstall, type PackagesFile, type SessionReach } from './model.js'

const ROUTE = /^\/mcp\/([^/]+)\/([^/]+)@([^/@]+)\/([^/]+)$/

export interface LaunchPlaces {
  /** `http://127.0.0.1:<port>` of the MCP gateway. */
  gateway: string
  /** `state/packages`. */
  cache: string
  /** The id of the project: a route outlives a rename of its key. */
  projectId: string
  /** The built-in bridge whose retired predecessor may still be pinned by this task. */
  builtIn?: string
}

/** What a session of the task gets: the gateway's servers, the plugin folders, and the install of each package. */
export interface SessionPackages {
  mcp: SessionMcp[]
  plugins: SessionPlugin[]
  installs: Record<string, string>
}

/**
 * The gateway's address of a server: the route alone finds the install and the project's settings, so a session
 * resumed with its saved flags reaches the same server after a restart of the service.
 */
export function routeOf(projectId: string, name: string, install: string, server: string): string {
  return `/mcp/${encodeURIComponent(projectId)}/${encodeURIComponent(name)}@${encodeURIComponent(install)}/${encodeURIComponent(server)}`
}

export function parseRoute(path: string): { project: string; name: string; install: string; server: string } | null {
  const match = ROUTE.exec(path)
  if (match === null) return null
  try {
    const [project, name, install, server] = match.slice(1).map(decodeURIComponent) as [string, string, string, string]
    return { project, name, install, server }
  } catch {
    return null
  }
}

export function pluginDir(cache: string, name: string, install: string): string {
  return join(cache, name, install, 'plugin')
}

/** The install's plugin without its MCP servers (`ensureServerless`). */
export function serverlessDir(cache: string, name: string, install: string): string {
  return join(cache, name, install, 'serverless')
}

/**
 * A copy of the install's plugin without `.mcp.json` and the manifest's `mcpServers`, made once: an install never
 * changes. For a Claude project chat (BTN-1371), whose CLI starts a `--plugin-dir` plugin's servers and can turn them
 * off only by `--strict-mcp-config`, which would drop the account's own servers too.
 */
export function ensureServerless(cache: string, name: string, install: string): string {
  const dir = serverlessDir(cache, name, install)
  if (existsSync(dir)) return dir
  const source = pluginDir(cache, name, install)
  const temp = `${dir}.${process.pid}.tmp`
  rmSync(temp, { recursive: true, force: true })
  cpSync(source, temp, { recursive: true, filter: (path) => path !== join(source, '.mcp.json') })
  const manifest = join(temp, '.claude-plugin', 'plugin.json')
  if (existsSync(manifest)) {
    const { mcpServers: _, ...rest } = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
    writeFileSync(manifest, `${JSON.stringify(rest, null, 2)}\n`)
  }
  try {
    renameSync(temp, dir)
  } catch (error) {
    rmSync(temp, { recursive: true, force: true })
    if (!existsSync(dir)) throw error
  }
  return dir
}

/** The marketplace of one install of a plugin package. */
export function marketplaceName(install: string): string {
  return `ek-${install}`
}

export function marketplaceFile(cache: string, name: string, install: string): string {
  return join(cache, name, install, '.claude-plugin', 'marketplace.json')
}

/** `marketplace.json` beside the install's `plugin` folder: Codex installs a plugin only from a marketplace. */
export function installMarketplace(plugin: string, install: string): Record<string, unknown> {
  return { name: marketplaceName(install), owner: { name: 'Even Keel' }, plugins: [{ name: plugin, source: './plugin' }] }
}

/** Written on the first session of an install, so installs made before Codex read plugins get one too. */
export function ensureMarketplace(cache: string, name: string, install: string, plugin: string): void {
  const file = marketplaceFile(cache, name, install)
  if (existsSync(file)) return
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(installMarketplace(plugin, install), null, 2)}\n`)
}

export function sessionPackages(file: PackagesFile, project: string, task: string, places: LaunchPlaces): SessionPackages {
  const mcp: SessionMcp[] = []
  const plugins: SessionPlugin[] = []
  const installs: Record<string, string> = {}
  for (const [name, id] of Object.entries(installsFor(file, project, task, places.builtIn))) {
    const record = file.packages[name]
    const install = record?.installs.find((each) => each.id === id)
    if (record === undefined || install === undefined) continue
    installs[name] = id
    if (record.kind === 'plugin' && record.plugin !== undefined) plugins.push(sessionPlugin(places.cache, name, record.plugin.name, install))
    for (const [server, entry] of Object.entries(install.servers)) {
      // The tasks server learns the session's task from its address: the session's own task is in its prompt (BTN-768);
      // the memory server stamps it on what the session writes (BTN-1029).
      const own = isTasksUrl(entry.entry.url) || isMemoryUrl(entry.entry.url) ? `?task=${encodeURIComponent(task)}` : ''
      mcp.push({ name: server, plugin: record.plugin?.name ?? null, url: `${places.gateway}${routeOf(places.projectId, name, id, server)}${own}` })
    }
  }
  return { mcp, plugins, installs }
}

/**
 * A project chat's plugins (BTN-1346): the built-in package's current install alone, for its hooks — the chat's mail
 * mid-turn. Its servers are named so that the agent turns them off (Claude gets a copy without them, `ensureServerless`):
 * the chat keeps the account's own configuration.
 */
export function bridgePlugins(file: PackagesFile, builtIn: string | undefined, cache: string): SessionPlugin[] {
  const record = builtIn === undefined ? undefined : file.packages[builtIn]
  const install = record === undefined ? undefined : current(record)
  if (builtIn === undefined || record?.plugin === undefined || record.removed === true || install === undefined) return []
  return [sessionPlugin(cache, builtIn, record.plugin.name, install)]
}

function sessionPlugin(cache: string, name: string, plugin: string, install: PackageInstall): SessionPlugin {
  return {
    package: name,
    dir: pluginDir(cache, name, install.id),
    name: plugin,
    marketplace: marketplaceName(install.id),
    marketplaceFile: marketplaceFile(cache, name, install.id),
    servers: Object.keys(install.servers),
  }
}

export function sessionReach(file: PackagesFile, project: string): SessionReach {
  const reach: SessionReach = { plugins: [], servers: [] }
  for (const name of enabledPackages(file, project)) {
    const record = file.packages[name]!
    if (record.plugin !== undefined) reach.plugins.push(pluginKey(record.plugin.name, record.plugin.marketplace))
    for (const server of Object.keys(current(record)?.servers ?? {})) reach.servers.push(gatewayName({ name: server, plugin: record.plugin?.name ?? null, url: '' }))
  }
  return reach
}

/**
 * `enabledPlugins` for `--settings`: every plugin the settings files enable and the set does not bring is turned off,
 * so its skills and hooks stay out of the session as its servers do.
 */
export function otherPlugins(settings: (Record<string, unknown> | undefined)[], set: string[]): Record<string, false> {
  const off: Record<string, false> = {}
  for (const each of settings) {
    const enabled = each?.enabledPlugins
    if (typeof enabled !== 'object' || enabled === null) continue
    for (const [name, on] of Object.entries(enabled)) if (on === true && !set.includes(name)) off[name] = false
  }
  return off
}
