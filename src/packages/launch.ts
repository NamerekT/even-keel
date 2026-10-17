import { join } from 'node:path'
import type { SessionMcp } from '../agent/contract.js'
import { installsFor, type PackagesFile } from './model.js'

const ROUTE = /^\/mcp\/([^/]+)\/([^/]+)@([^/@]+)\/([^/]+)$/

export interface LaunchPlaces {
  /** `http://127.0.0.1:<port>` of the MCP gateway. */
  gateway: string
  /** `state/packages`. */
  cache: string
  /** The id of the project: a route outlives a rename of its key. */
  projectId: string
}

/** What a session of the task gets: the gateway's servers, the plugin folders, and the install of each package. */
export interface SessionPackages {
  mcp: SessionMcp[]
  plugins: string[]
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

export function sessionPackages(file: PackagesFile, project: string, task: string, places: LaunchPlaces): SessionPackages {
  const mcp: SessionMcp[] = []
  const plugins: string[] = []
  const installs: Record<string, string> = {}
  for (const [name, id] of Object.entries(installsFor(file, project, task))) {
    const record = file.packages[name]
    const install = record?.installs.find((each) => each.id === id)
    if (record === undefined || install === undefined) continue
    installs[name] = id
    if (record.kind === 'plugin') plugins.push(pluginDir(places.cache, name, id))
    for (const server of Object.keys(install.servers)) {
      mcp.push({ name: server, plugin: record.plugin?.name ?? null, url: `${places.gateway}${routeOf(places.projectId, name, id, server)}` })
    }
  }
  return { mcp, plugins, installs }
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
