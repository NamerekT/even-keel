import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fail } from '../notice/notice.js'
import { defaultSettings } from './keys.js'
import { emptyPackages, pluginKey, type PackagesFile, type ServerEntry } from './model.js'

type Json = Record<string, unknown>

/** What a plugin brings besides MCP servers. */
const EXTRAS = ['skills', 'hooks', 'commands', 'agents']

/** Where a plugin's files are copied from, and the kind of its marketplace's source (`directory`, `github`, `git`, …). */
export interface PluginPlace {
  dir: string
  kind: string
}

interface Marketplace {
  location: string
  kind: string
  /** When the CLI last fetched it. */
  fetched: unknown
}

/** The name in the `.claude-plugin/marketplace.json` of a folder: Even Keel's own plugins, read from its checkout. */
export function ownMarketplace(root: string): string | undefined {
  const name = readJson(join(root, '.claude-plugin', 'marketplace.json'))?.name
  return typeof name === 'string' ? name : undefined
}

/** Whether the global configuration knows the marketplace: sessions started by hand install plugins only from those. */
export function knowsMarketplace(globalDir: string, marketplace: string): boolean {
  return marketplace in knownMarketplaces(globalDir)
}

function knownMarketplaces(globalDir: string): Json {
  return objectOf(readJson(join(globalDir, 'plugins', 'known_marketplaces.json')))
}

/**
 * The marketplaces of the global configuration (`plugins/known_marketplaces.json`), with Even Keel's own folder first
 * when given: chain sessions get copies, so its plugins need no `claude plugin marketplace add`, and the checkout's
 * version wins over a marketplace of the same name the CLI keeps elsewhere.
 */
function marketplaces(globalDir: string, own?: string): Map<string, Marketplace> {
  const found = new Map<string, Marketplace>()
  const ownName = own === undefined ? undefined : ownMarketplace(own)
  if (ownName !== undefined) found.set(ownName, { location: own!, kind: 'directory', fetched: undefined })
  for (const [name, value] of Object.entries(knownMarketplaces(globalDir))) {
    const known = objectOf(value)
    if (found.has(name) || typeof known.installLocation !== 'string') continue
    found.set(name, { location: known.installLocation, kind: String(objectOf(known.source).source ?? 'unknown'), fetched: known.lastUpdated })
  }
  return found
}

/**
 * A plugin of Even Keel's own marketplace or of one the global configuration knows: a path inside the marketplace is
 * its folder there, any other source is the copy the CLI installed (`plugins/installed_plugins.json`).
 */
export function locatePlugin(globalDir: string, plugin: string, marketplace: string, own?: string): PluginPlace {
  const found = marketplaces(globalDir, own).get(marketplace)
  if (found === undefined) throw fail('packages.noMarketplace', { marketplace })
  const { location, kind } = found
  const entry = pluginsOf(location).find((each) => each.name === plugin)
  if (entry === undefined) throw fail('packages.noPlugin', { plugin, marketplace })
  if (typeof entry.source === 'string') return { dir: resolve(location, entry.source), kind }
  const installed = objectOf(readJson(join(globalDir, 'plugins', 'installed_plugins.json'))?.plugins)
  const install = listOf(installed[pluginKey(plugin, marketplace)]).map(objectOf)[0]?.installPath
  if (typeof install !== 'string' || !existsSync(install)) throw fail('packages.installInClaude', { plugin: pluginKey(plugin, marketplace) })
  return { dir: install, kind }
}

/** Marketplaces the CLI fetches: an update pulls them first. */
export const FETCHED = new Set(['github', 'git', 'url'])

/**
 * The version an update would install now, and when the CLI last fetched the marketplace that version comes from
 * (`null` for a folder, which is always current); `undefined` when the plugin cannot be found.
 */
export function pluginOffer(globalDir: string, plugin: string, marketplace: string, own?: string): { version: string | null; fetched: string | null } | undefined {
  let place: PluginPlace
  try {
    place = locatePlugin(globalDir, plugin, marketplace, own)
  } catch {
    return undefined
  }
  const fetched = marketplaces(globalDir, own).get(marketplace)?.fetched
  return { version: pluginVersion(place.dir), fetched: FETCHED.has(place.kind) && typeof fetched === 'string' ? fetched : null }
}

/** Every plugin of Even Keel's own marketplace and of every one the global configuration knows: the page offers them to add. */
export function availablePlugins(globalDir: string, own?: string): { plugin: string; marketplace: string }[] {
  return [...marketplaces(globalDir, own)].flatMap(([marketplace, { location }]) => pluginsOf(location).map((each) => ({ plugin: each.name, marketplace })))
}

function pluginsOf(location: string): { name: string; source: unknown }[] {
  return listOf(readJson(join(location, '.claude-plugin', 'marketplace.json'))?.plugins)
    .map(objectOf)
    .filter((each): each is { name: string; source: unknown } => typeof each.name === 'string')
}

/** The plugin's MCP servers: its `.mcp.json` and the manifest's `mcpServers`, inline or a file. */
export function pluginServers(dir: string): Record<string, ServerEntry> {
  const manifest = readJson(join(dir, '.claude-plugin', 'plugin.json'))
  const declared = manifest?.mcpServers
  const fromManifest = typeof declared === 'string' ? serversIn(readJson(resolve(dir, declared))) : objectOf(declared)
  return { ...serversIn(readJson(join(dir, '.mcp.json'))), ...fromManifest } as Record<string, ServerEntry>
}

export function pluginVersion(dir: string): string | null {
  const version = readJson(join(dir, '.claude-plugin', 'plugin.json'))?.version
  return typeof version === 'string' ? version : null
}

export function hasExtras(dir: string): boolean {
  return EXTRAS.some((name) => existsSync(join(dir, name)))
}

/** The servers of a `.mcp.json`, which may also list them at the top. */
export function serversIn(file: Json | undefined): Json {
  if (file === undefined) return {}
  return 'mcpServers' in file ? objectOf(file.mcpServers) : file
}

export interface SeedInput {
  /** The global `settings.json`. */
  globalSettings: Json | undefined
  /** Each project's `.claude/settings.json` and `settings.local.json`, in that order. */
  projects: { key: string; settings: Json[] }[]
  /** User scope servers of the `.claude.json` files sessions read. */
  userServers: Record<string, ServerEntry>
}

/**
 * The first catalog, from what chain sessions get without it: the globally enabled plugins and the user scope servers
 * for every project, a plugin a project enables for that project only, and one it disables off for it.
 */
export function seedPackages(input: SeedInput): PackagesFile {
  const file = emptyPackages()
  const global = enabledOf(input.globalSettings)
  const addPlugin = (key: string, on: boolean) => {
    if (key in file.packages) return
    const at = key.lastIndexOf('@')
    if (at <= 0) return
    file.packages[key] = { kind: 'plugin', plugin: { name: key.slice(0, at), marketplace: key.slice(at + 1) }, default: on, settings: {}, installs: [] }
  }
  for (const [key, on] of Object.entries(global)) if (on) addPlugin(key, true)
  for (const { key: project, settings } of input.projects) {
    const own: Record<string, boolean> = Object.assign({}, ...settings.map(enabledOf))
    const set = { on: [] as string[], off: [] as string[], settings: {} }
    for (const [key, on] of Object.entries(own)) {
      if (on && global[key] !== true) {
        addPlugin(key, false)
        if (key in file.packages) set.on.push(key)
      } else if (!on && global[key] === true && key in file.packages) set.off.push(key)
    }
    if (set.on.length > 0 || set.off.length > 0) file.projects[project] = set
  }
  for (const [name, server] of Object.entries(input.userServers)) {
    if (!(name in file.packages)) file.packages[name] = { kind: 'mcp', server, default: true, settings: defaultSettings({ [name]: server }), installs: [] }
  }
  return file
}

function enabledOf(settings: Json | undefined): Record<string, boolean> {
  return Object.fromEntries(Object.entries(objectOf(settings?.enabledPlugins)).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
}

export function readJson(file: string): Json | undefined {
  try {
    const text = readFileSync(file, 'utf8')
    const value: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
  } catch {
    return undefined
  }
}

export function objectOf(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
