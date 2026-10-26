import { defaultSettings } from './settings.js'

/** An MCP server's entry as `.mcp.json` writes it: `command`, `args`, `env` for stdio, `type`, `url`, `headers` for HTTP. */
export type ServerEntry = Record<string, unknown>

/** A server of an install: the entry the gateway runs, an `npx` one pinned to `node <bin>` of the installed version. */
export interface InstalledServer {
  entry: ServerEntry
  /** The npm package a pinned stdio server runs; `null` — the command runs as it is, its version is not pinned. */
  npm: { name: string; version: string } | null
}

/** One install of a package: its files lie in `state/packages/<package>/<id>/`. */
export interface PackageInstall {
  id: string
  /** The plugin's `version`, or the npm version of an MCP package's server; `null` — none to tell. */
  version: string | null
  at: string
  servers: Record<string, InstalledServer>
  /** The plugin brings skills, hooks, commands or agents: an agent without Claude Code's plugins does not get them. */
  extras: boolean
}

export interface PackageRecord {
  kind: 'plugin' | 'mcp'
  /** A plugin's name and its marketplace, as the CLI knows them. */
  plugin?: { name: string; marketplace: string }
  /** An MCP package's server entry as it was added. */
  server?: ServerEntry
  /** Projects get it unless they turn it off. */
  default: boolean
  /** User overrides of the install's settings (`env` of a stdio server, headers of an HTTP one). */
  settings: Record<string, string>
  /** Oldest first: the last one is current. */
  installs: PackageInstall[]
  /** Removed from the catalog; kept while a task still runs on one of its installs. */
  removed?: boolean
}

/** A project's set on top of the defaults. */
export interface ProjectSet {
  on: string[]
  off: string[]
  /** By package: the values that differ from the package's. */
  settings: Record<string, Record<string, string>>
}

/** `state/packages.json`: projects by their id, as every file of `state/`. */
export interface PackagesFile {
  packages: Record<string, PackageRecord>
  projects: Record<string, ProjectSet>
  /** By project id, then task: the install id of each package the task's sessions run on. */
  pins: Record<string, Record<string, Record<string, string>>>
}

/** What the project's sessions get from its packages: the plugins as `enabledPlugins` names them, the servers as tools do. */
export interface SessionReach {
  plugins: string[]
  servers: string[]
}

export function emptyPackages(): PackagesFile {
  return { packages: {}, projects: {}, pins: {} }
}

/** A plugin package is named the way `enabledPlugins` names it. */
export function pluginKey(plugin: string, marketplace: string): string {
  return `${plugin}@${marketplace}`
}

export function current(record: PackageRecord): PackageInstall | undefined {
  return record.installs.at(-1)
}

/** Whether the project's sessions get the package: its own choice, else the package's default. */
export function enabledIn(file: PackagesFile, project: string, name: string): boolean {
  const record = file.packages[name]
  if (record === undefined || record.removed === true) return false
  const set = file.projects[project]
  if (set?.on.includes(name)) return true
  if (set?.off.includes(name)) return false
  return record.default
}

export function enabledPackages(file: PackagesFile, project: string): string[] {
  return Object.keys(file.packages).filter((name) => enabledIn(file, project, name))
}

export function defaultsOf(record: PackageRecord): Record<string, string> {
  const install = current(record)
  const entries = install === undefined ? { server: record.server ?? {} } : Object.fromEntries(Object.entries(install.servers).map(([name, server]) => [name, server.entry]))
  return defaultSettings(entries)
}

export function packageSettings(record: PackageRecord): Record<string, string> {
  return { ...defaultsOf(record), ...record.settings }
}

/** The project's overrides over the current install's defaults and the package's values, for the page. */
export function settingsOf(file: PackagesFile, project: string, name: string): Record<string, string> {
  const record = file.packages[name]
  return { ...(record === undefined ? {} : packageSettings(record)), ...file.projects[project]?.settings[name] }
}

/** What a session of the task runs on: its pins, else the current install of every package the project has. */
export function installsFor(file: PackagesFile, project: string, task: string): Record<string, string> {
  const pinned = file.pins[project]?.[task]
  if (pinned !== undefined) return pinned
  const installs: Record<string, string> = {}
  for (const name of enabledPackages(file, project)) {
    const install = current(file.packages[name]!)
    if (install !== undefined) installs[name] = install.id
  }
  return installs
}

/** Installs no pin holds and that are not current: their files may go. */
export function unpinned(file: PackagesFile): { name: string; id: string }[] {
  const held = new Set(
    Object.values(file.pins)
      .flatMap((tasks) => Object.values(tasks))
      .flatMap((installs) => Object.entries(installs).map(([name, id]) => `${name}\u0000${id}`)),
  )
  return Object.entries(file.packages).flatMap(([name, record]) =>
    record.installs.filter((install, index) => (record.removed === true || index < record.installs.length - 1) && !held.has(`${name}\u0000${install.id}`)).map(({ id }) => ({ name, id })),
  )
}
