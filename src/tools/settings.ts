import { stripSettingsGuard } from '../account/settingsGuardStrip.js'
import { strictest, type CodexDecision, type CodexRule } from '../codex/rules.js'
import type { SessionReach } from '../packages/model.js'
import type { SettingKind, SettingRow, ToolScope } from './model.js'

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
const KIND_ORDER: SettingKind[] = ['sync', 'mode', 'plugin', 'skill', 'permission', 'codex']
const SESSION_SCOPES: ToolScope[] = ['chain', 'project', 'user']
const BEHAVIORS = ['allow', 'deny', 'ask']
const MCP_RULE = /^mcp__(.+?)(?:__|$)/

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

export interface SettingSources {
  user?: Json
  project?: Json
  local?: Json
  chain?: Json
  chainMode?: string
  /** `allowedTools` of the main checkout in `.claude.json`. */
  localAllowed?: string[]
  /** The rules of the project's Codex account folder and of the branch's `.codex/rules/`. */
  codexUser?: CodexRule[]
  codexProject?: CodexRule[]
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
  for (const [scope, rules] of [['user', sources.codexUser], ['project', sources.codexProject]] as const) {
    for (const { pattern, decision } of rules ?? []) {
      const before = rows.get(`codex\u0000${pattern}`)?.values[scope] as CodexDecision | undefined
      put('codex', pattern, scope, strictest(before === undefined ? [decision] : [before, decision])!)
    }
  }

  for (const row of rows.values()) {
    const values = SESSION_SCOPES.map((scope) => row.values[scope]).filter((value) => value !== undefined)
    row.session = (row.kind === 'codex' ? strictest(values as CodexDecision[]) : values[0]) ?? null
  }
  return [...rows.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name))
}

/**
 * A plugin or MCP permission only `settings.local.json` sets, for a package the project's sessions do not get: they
 * have plugins and MCP only as packages, so it is not theirs to miss. A plugin's server `plugin_<plugin>_<server>` goes
 * by its plugin.
 */
export function forPackageOff(row: SettingRow, reach: SessionReach): boolean {
  if (row.session !== null) return false
  if (row.kind === 'plugin') return !reach.plugins.includes(row.name)
  const server = row.kind === 'permission' ? MCP_RULE.exec(row.name)?.[1] : undefined
  if (server === undefined) return false
  const plugins = reach.plugins.map((key) => `plugin_${key.split('@')[0]}_`)
  return !reach.servers.includes(server) && !plugins.some((prefix) => server.startsWith(prefix))
}

/** Key names only: values may hold secrets (`env`). Even Keel's own settings guard in the folder is no difference. */
export function accountDrift(global: Json, folder: Json): string[] {
  global = stripSettingsGuard(global)
  folder = stripSettingsGuard(folder)
  const keys = new Set([...Object.keys(global), ...Object.keys(folder)])
  return [...keys].filter((key) => comparable(key, global[key]) !== comparable(key, folder[key])).sort()
}

/** Removing the guard may leave an empty event list or no `hooks` at all where the global file had them empty. */
function comparable(key: string, value: unknown): string | undefined {
  if (key !== 'hooks' || value === undefined) return JSON.stringify(value)
  const hooks = Object.entries(objectOf(value)).filter(([, groups]) => !Array.isArray(groups) || groups.length > 0)
  return hooks.length === 0 ? undefined : JSON.stringify(Object.fromEntries(hooks))
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
