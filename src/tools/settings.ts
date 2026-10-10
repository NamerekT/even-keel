import { isInside, pathsOf, samePath } from '../paths.js'
import { type McpSources, serversIn } from '../tracker/mcp.js'
import type { McpRow, SettingKind, SettingRow, ToolScope } from './model.js'

type Json = Record<string, unknown>

/** Bundled skills for interactive work: a chain session does not need them in its listing. */
export const DEFAULT_HIDDEN_SKILLS = [
  'update-config',
  'keybindings-help',
  'fewer-permission-prompts',
  'loop',
  'schedule',
  'init',
  'claude-api',
  'claude-in-chrome',
  'plugin-authoring',
  'artifact-design',
  'artifact-diagramming',
  'artifact-capabilities',
  'dataviz',
]

const HIDDEN = 'user-invocable-only'
const SYNC_KEYS = ['syncClaudeAiSkills', 'syncClaudeAiPlugins']
const KIND_ORDER: SettingKind[] = ['sync', 'mode', 'plugin', 'skill', 'permission']
const SESSION_SCOPES: ToolScope[] = ['chain', 'project', 'user']
const BEHAVIORS = ['allow', 'deny', 'ask']

/**
 * Settings a chain session gets with `--settings`: claude.ai skills and plugins off, the hidden skills only for `/name`.
 * The project's own `skillOverrides` win, those of `settings.local.json` too: a worktree does not read that file.
 */
export function trimSettings(hidden: string[], project: Json | undefined, local: Json | undefined): Json {
  const overrides: Json = Object.fromEntries(hidden.map((name) => [name, HIDDEN]))
  return {
    syncClaudeAiSkills: false,
    syncClaudeAiPlugins: false,
    skillOverrides: { ...overrides, ...objectOf(project?.skillOverrides), ...objectOf(local?.skillOverrides) },
  }
}

/**
 * Servers of the main checkout's `.mcp.json` that a session in a worktree inside it would see but not have itself.
 * The CLI looks for `.mcp.json` in parent folders too, and the approval in `settings.local.json` does not reach
 * the worktree: a `--bg` session hangs on the approval dialog. Chain sessions get them in `disabledMcpjsonServers`.
 */
export function strayMcpServers(
  repo: string,
  cwd: string,
  read: (file: string) => Json | undefined,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (samePath(cwd, repo, platform) || !isInside(cwd, repo, platform)) return []
  const { join } = pathsOf(platform)
  const own = serversIn(read(join(cwd, '.mcp.json')))
  return Object.keys(serversIn(read(join(repo, '.mcp.json')))).filter((name) => !(name in own))
}

export interface SettingSources {
  user?: Json
  project?: Json
  local?: Json
  chain?: Json
  chainMode?: string
  /** `allowedTools` of the main checkout in `.claude.json`. */
  localAllowed?: string[]
}

export function settingRows(sources: SettingSources): SettingRow[] {
  const rows = new Map<string, SettingRow>()
  const put = (kind: SettingKind, name: string, scope: ToolScope, value: string) => {
    const key = `${kind}\u0000${name}`
    const row = rows.get(key) ?? { kind, name, values: {}, session: null }
    row.values[scope] = value
    rows.set(key, row)
  }
  for (const scope of ['user', 'project', 'local', 'chain'] as const) {
    const settings = sources[scope]
    if (settings === undefined) continue
    for (const key of SYNC_KEYS) if (typeof settings[key] === 'boolean') put('sync', key, scope, onOff(settings[key]))
    for (const [name, on] of Object.entries(objectOf(settings.enabledPlugins))) if (typeof on === 'boolean') put('plugin', name, scope, onOff(on))
    for (const [name, value] of Object.entries(objectOf(settings.skillOverrides))) if (typeof value === 'string') put('skill', name, scope, value)
    const permissions = objectOf(settings.permissions)
    if (typeof permissions.defaultMode === 'string') put('mode', 'defaultMode', scope, permissions.defaultMode)
    for (const behavior of BEHAVIORS) for (const rule of strings(permissions[behavior])) put('permission', rule, scope, behavior)
  }
  if (sources.chainMode !== undefined) put('mode', 'defaultMode', 'chain', sources.chainMode)
  for (const rule of sources.localAllowed ?? []) put('permission', rule, 'local', 'allow')

  for (const row of rows.values()) row.session = SESSION_SCOPES.map((scope) => row.values[scope]).find((value) => value !== undefined) ?? null
  return [...rows.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name))
}

export function mcpRows(sources: McpSources, repo: string, platform: NodeJS.Platform = process.platform): McpRow[] {
  const projects = sources.configs.flatMap((config) =>
    Object.entries(objectOf(config.projects))
      .filter(([path]) => samePath(path, repo, platform))
      .map(([, project]) => objectOf(project)),
  )
  const listedIn = (key: string, name: string) => projects.some((project) => strings(project[key]).includes(name))
  const rows: McpRow[] = []
  const add = (row: McpRow) => {
    if (!rows.some((each) => each.scope === row.scope && each.name === row.name && each.plugin === row.plugin)) rows.push(row)
  }
  for (const config of sources.configs) {
    for (const name of Object.keys(objectOf(config.mcpServers))) {
      add({ name, scope: 'user', plugin: null, disabled: listedIn('disabledMcpServers', name), worktree: true })
    }
  }
  for (const project of projects) {
    for (const name of Object.keys(objectOf(project.mcpServers))) {
      add({ name, scope: 'local', plugin: null, disabled: listedIn('disabledMcpServers', name), worktree: false })
    }
  }
  for (const name of Object.keys(sources.repoServers)) {
    add({ name, scope: 'project', plugin: null, disabled: listedIn('disabledMcpjsonServers', name), worktree: true })
  }
  for (const plugin of sources.plugins) {
    for (const name of Object.keys(plugin.servers)) {
      add({ name, scope: 'plugin', plugin: plugin.name, disabled: listedIn('disabledMcpServers', `plugin:${plugin.name}:${name}`), worktree: true })
    }
  }
  return rows
}

/** Key names only: values may hold secrets (`env`). */
export function accountDrift(global: Json, folder: Json): string[] {
  const keys = new Set([...Object.keys(global), ...Object.keys(folder)])
  return [...keys].filter((key) => JSON.stringify(global[key]) !== JSON.stringify(folder[key])).sort()
}

function onOff(value: unknown): string {
  return value === true ? 'on' : 'off'
}

function objectOf(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : []
}
