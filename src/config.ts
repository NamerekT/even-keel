import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { sameName, type ChainRules } from './chain/rules.js'
import type { Language } from './language.js'
import { fail } from './notice/notice.js'
import { colorsOf } from './projects/colors.js'
import type { PoolEntry } from './account/model.js'
import type { RunSettings } from './sessions/launch.js'
import type { CacheTtl, CiSettings, ContextScale, ProjectSettings, StatsConfig } from './state.js'
import { CI_KINDS, type RemoteProfiles } from './ci/model.js'
import { DEFAULT_CHANGELOG } from './changelog/file.js'
import { changesOf, type FormValue } from './settings/changes.js'
import { DEFAULT_BRANCH, DEFAULT_LANGUAGE } from './settings/defaults.js'
import type { TallyMode } from './stats/mode.js'
import { fileRows, isPlainObject, writeRows } from './settings/file.js'
import { checkRows, inherit, resolve, type ProjectRecord, type Resolved, type Values } from './settings/resolve.js'
import { ADAPTERS } from './tracker/adapters.js'
import type { TrackerAdapter } from './tracker/source.js'
import type { UpdateSettings } from './updates/release.js'

export {
  CONFIG_FILE,
  DEFAULT_ACCOUNTS,
  DEFAULT_BRANCH,
  DEFAULT_CI,
  DEFAULT_COMPARE,
  DEFAULT_CONTEXT,
  DEFAULT_EXECUTION,
  DEFAULT_LANGUAGE,
  DEFAULT_MODELS,
} from './settings/defaults.js'
export { isPlainObject } from './settings/file.js'

export interface EvenKeelConfig {
  /** Names besides loopback and `EVEN_KEEL_HOST` the page may be reached by — a proxy's name, say. */
  allowedHosts: string[]
  /**
   * The repository of each project by its key, in the order of the file. Inside the running service a project goes by its
   * key; the key may change across restarts, so what outlives the process — the files of `state/`, the page's URL — names
   * it by its id.
   */
  projects: Record<string, string>
  /** The id of each project by its key: a GUID that never changes. */
  ids: Record<string, string>
  /** The names projects are shown by, only those that have one. */
  names: Record<string, string>
  /** The shared rules, defaults filled in; a project's own keys go over them into `rules`. */
  chain: ChainRules
  rules: Record<string, ChainRules>
  slots: Record<string, number>
  /** The palette slot of each project (`colorsOf`): its own `color` or a free one; a project past the free ones has none. */
  colors: Record<string, number>
  tracker: string
  trackers: Record<string, string>
  trackerProjects: Record<string, string>
  /** The shared `brief`; `briefs` — what each project ends up with. `null` — left to the project's packages (`briefOn`). */
  brief: boolean | null
  briefs: Record<string, boolean | null>
  settings: Record<string, ProjectSettings>
  context: ContextScale
  /** The shared provider; a project's own `provider` goes over it. */
  provider: string
  /** The shared model by provider, defaults filled in; a project's own entries go over them. */
  models: Record<string, string>
  /** The shared account folder by provider, defaults filled in; the shared provider's entry is the active account of the header. */
  accounts: Record<string, string>
  /** The mode of each provider's sessions, defaults filled in; shared only: the Codex sandbox does not start under the service for any project. */
  execution: Record<string, string>
  /** Which CLI each provider's sessions run on (`CLI_SOURCES`), defaults filled in; shared only: an account folder has one daemon. */
  cli: Record<string, string>
  /** Whether the tasks' run labels are read, unless a project says otherwise. */
  modelLabels: boolean
  /** Appended to the prompt of a new session by the name of its model, as the CLI gets it. */
  modelPrompts: Record<string, string>
  stats: StatsConfig
  language: Language | null
  promptLanguage: Language
  /** Skills chain sessions get only for `/name` while trimming is on. */
  hiddenSkills: string[]
  /** The prompt cache TTL of chain sessions (`promptCacheTtl`); null leaves the CLI's own choice. */
  cacheTtl: CacheTtl | null
  /** Chains run at once; the rest wait in the queue. */
  parallel: number
  /** Even Keel's setting rows the chain's switches write (`chain/unattended`, `chain/trim`), not the forms. */
  unattended: boolean
  trimTools: boolean
  /** Where Tally writes, set by the page's stats setup and settings (`stats/tally`); `null` — not chosen yet. */
  tally: TallyMode | null
  /** The switches only: the version whose toast was closed is state (`service_state`). */
  updates: Pick<UpdateSettings, 'check' | 'notify'>
}

export const RULE_KEYS = ['active', 'terminal', 'requiredLabels', 'excludedLabels'] as const
/** Keys an older config had; the address now comes from `EVEN_KEEL_HOST` and `EVEN_KEEL_PORT`. */
const IGNORED_KEYS = ['host', 'port'] as const
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 4747
const DEFAULT_MCP_PORT = 4748

type AdapterShapes = Readonly<Record<string, Pick<TrackerAdapter, 'projectKey'>>>

/** The keys a project entry names its tracker's project by (`github`, `linear`). */
export const trackerKeysOf = (adapters: AdapterShapes) => [
  ...new Set(Object.values(adapters).flatMap(({ projectKey }) => (projectKey === undefined ? [] : [projectKey.key]))),
]

/** The file's project records and rows, each row checked by the registry, resolved into what the service runs on. */
export function parseConfig(raw: unknown, adapters: AdapterShapes = ADAPTERS): EvenKeelConfig {
  const { records, rows } = fileRows(raw, trackerKeysOf(adapters))
  return configOf(records, resolve(records, checkRows(rows, records, { trackers: Object.keys(adapters) })), adapters)
}

const rulesOf = (values: Values): ChainRules => ({
  active: values['chain.active'] as string[] | null,
  terminal: values['chain.terminal'] as string[] | null,
  requiredLabels: values['chain.requiredLabels'] as string[],
  excludedLabels: values['chain.excludedLabels'] as string[],
})

function configOf(records: ProjectRecord[], { shared, own, values }: Resolved, adapters: AdapterShapes): EvenKeelConfig {
  const byKey = <T>(pick: (record: ProjectRecord, values: Values, own: Values) => T | undefined): Record<string, T> =>
    Object.fromEntries(
      records.flatMap((record) => {
        const value = pick(record, values[record.id]!, own[record.id]!)
        return value === undefined ? [] : [[record.key, value]]
      }),
    )
  const context = { window: shared['context.window'], warn: shared['context.warn'], danger: shared['context.danger'] } as ContextScale
  if (context.warn >= context.danger) throw fail('config.contextPercents', {})
  const language = shared.language as Language | null
  return {
    allowedHosts: shared.allowedHosts as string[],
    projects: byKey((record) => record.repo),
    ids: byKey((record) => record.id),
    names: byKey((record) => record.name ?? undefined),
    chain: rulesOf(shared),
    rules: byKey((record, project) => checkRules(rulesOf(project), record.key)),
    slots: byKey((_, { slot }) => (slot === true ? 1 : typeof slot === 'number' ? slot : undefined)),
    colors: colorsOf(
      records.map((record) => record.key),
      byKey((_, { color }) => color as number | undefined),
    ),
    tracker: shared.tracker as string,
    trackers: byKey((_, project) => project.tracker as string),
    trackerProjects: byKey((record, project) => trackerProjectOf(record, project.tracker as string, adapters)),
    brief: shared.brief as boolean | null,
    briefs: byKey((_, project) => project.brief as boolean | null),
    settings: byKey(settingsOf),
    context,
    provider: shared.provider as string,
    models: shared.models as Record<string, string>,
    accounts: shared.accounts as Record<string, string>,
    execution: shared.execution as Record<string, string>,
    cli: shared.cli as Record<string, string>,
    modelLabels: shared.modelLabels as boolean,
    modelPrompts: shared.modelPrompts as Record<string, string>,
    stats: {
      compare: { minTasks: shared['stats.compare.minTasks'], minSessions: shared['stats.compare.minSessions'], days: shared['stats.compare.days'] },
      moves: shared['stats.moves'],
      otherBelow: shared['stats.otherBelow'],
      checkpointTokens: shared['stats.checkpointTokens'],
    } as StatsConfig,
    language,
    promptLanguage: (shared.promptLanguage as Language | undefined) ?? language ?? DEFAULT_LANGUAGE,
    hiddenSkills: shared.hiddenSkills as string[],
    cacheTtl: shared.cacheTtl as CacheTtl | null,
    parallel: shared.parallel as number,
    unattended: shared.unattended as boolean,
    trimTools: shared.trimTools as boolean,
    tally: shared.tally as TallyMode | null,
    updates: { check: shared['updates.check'] as boolean, notify: shared['updates.notify'] as boolean },
  }
}

function settingsOf(record: ProjectRecord, values: Values, own: Values): ProjectSettings {
  return {
    branch: record.branch,
    prompt: values.prompt as string | null,
    beforeStart: values['commands.beforeStart'] as string[],
    check: values['commands.check'] as string[],
    afterGreen: values['commands.afterGreen'] as string[],
    ci: {
      guard: values['ci.guard'],
      kinds: values['ci.kinds'],
      waitMinutes: values['ci.waitMinutes'],
      recheckMain: values['ci.recheckMain'],
      fixTask: values['ci.fixTask'],
    } as CiSettings,
    remoteProfiles: values.remoteProfiles as RemoteProfiles,
    pullRequests: values.pullRequests as boolean,
    fillMilestone: values.fillMilestone as boolean,
    changelog: values.changelog as string,
    provider: (own.provider as string | undefined) ?? null,
    models: (own.models as Record<string, string> | undefined) ?? {},
    accounts: (own.accounts as Record<string, string> | undefined) ?? {},
    modelLabels: (own.modelLabels as boolean | undefined) ?? null,
  }
}

function trackerProjectOf(record: ProjectRecord, tracker: string, adapters: AdapterShapes): string | undefined {
  const projectKey = adapters[tracker]?.projectKey
  if (projectKey === undefined) return undefined
  const raw = record.trackerProjects[projectKey.key]
  if (projectKey.optional && raw === undefined) return undefined
  if (typeof raw !== 'string' || !projectKey.pattern.test(raw.trim())) throw fail('config.trackerProject', { where: `${record.key}.${projectKey.key}`, example: projectKey.example })
  return raw.trim()
}

function checkRules(rules: ChainRules, project: string): ChainRules {
  const clash = (a: string[], b: string[]) => a.find((name) => b.some((other) => sameName(name, other)))
  const status = clash(rules.active ?? [], rules.terminal ?? [])
  if (status !== undefined) throw fail('config.statusBoth', { project, status })
  const label = clash(rules.requiredLabels, rules.excludedLabels)
  if (label !== undefined) throw fail('config.labelBoth', { project, label })
  return rules
}

/**
 * The raw config with an id given to every project entry that has none — one added by hand — and the keys of those
 * entries; the same object when there are none. The service writes the result back into the file.
 */
export function withIds(raw: unknown, newId: () => string = randomUUID): { raw: unknown; keys: string[] } {
  const projects = isPlainObject(raw) ? raw.projects : undefined
  if (!Array.isArray(projects)) return { raw, keys: [] }
  const keys: string[] = []
  const filled = projects.map((entry: unknown) => {
    if (!isPlainObject(entry) || entry.id !== undefined) return entry
    keys.push(String(entry.key))
    return { id: newId(), ...entry }
  })
  return keys.length === 0 ? { raw, keys } : { raw: { ...(raw as Record<string, unknown>), projects: filled }, keys }
}

/** Where the service listens: `EVEN_KEEL_HOST` and `EVEN_KEEL_PORT`, loopback and 4747 without them. */
export function listenOf(env: NodeJS.ProcessEnv): { host: string; port: number } {
  const host = env.EVEN_KEEL_HOST?.trim() || DEFAULT_HOST
  const text = env.EVEN_KEEL_PORT?.trim() || String(DEFAULT_PORT)
  const port = /^\d+$/.test(text) ? Number(text) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('config.port', { value: text })
  return { host, port }
}

/** The port of the MCP gateway (`src/packages/gateway.ts`), always on 127.0.0.1. */
export function mcpPortOf(env: NodeJS.ProcessEnv): number {
  const text = env.EVEN_KEEL_MCP_PORT?.trim() || String(DEFAULT_MCP_PORT)
  const port = /^\d+$/.test(text) ? Number(text) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('config.mcpPort', { value: text })
  return port
}

/** The keys of the raw config that are no longer read. */
export function ignoredKeys(raw: unknown): string[] {
  return isPlainObject(raw) ? IGNORED_KEYS.filter((key) => Object.hasOwn(raw, key)) : []
}

/** What the project's sessions run on: its own provider, models, accounts and labels switch over the shared ones. */
export function runSettings(config: Pick<EvenKeelConfig, 'settings' | 'provider' | 'models' | 'accounts' | 'modelLabels'>, project: string | undefined): RunSettings {
  const own = project === undefined ? undefined : config.settings[project]
  return {
    provider: inherit('provider', config.provider, own?.provider ?? undefined) as string,
    models: inherit('models', config.models, own?.models) as Record<string, string>,
    accounts: inherit('accounts', config.accounts, own?.accounts) as Record<string, string>,
    labels: inherit('modelLabels', config.modelLabels, own?.modelLabels ?? undefined) as boolean,
  }
}

type PoolConfig = Pick<EvenKeelConfig, 'settings' | 'accounts'>

/** The pool entries of the config: the shared pool's, then each project's own. */
export function poolEntries(config: PoolConfig, projects: string[]): PoolEntry[] {
  const entries = (project: string | null, accounts: Record<string, string> | undefined) =>
    Object.entries(accounts ?? {}).map(([provider, account]) => ({ project, provider, account }))
  return [...entries(null, config.accounts), ...projects.flatMap((project) => entries(project, config.settings[project]?.accounts))]
}

/** The account folder each project's sessions run on by its provider (`runSettings`), as the projects on each folder. */
export function projectsByAccount(config: Parameters<typeof runSettings>[0], projects: string[]): Record<string, string[]> {
  const found: Record<string, string[]> = {}
  for (const project of projects) {
    const run = runSettings(config, project)
    const account = run.accounts[run.provider]
    if (account !== undefined) (found[account] ??= []).push(project)
  }
  return found
}

/** The config of the file, an entry without an id given one in memory only: for readers that do not write the file. */
export function loadConfig(file: string): EvenKeelConfig {
  return parseConfig(withIds(readRawConfig(file)).raw)
}

export function readRawConfig(file: string): unknown {
  const text = readFileSync(file, 'utf8')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw fail('config.notJson', { file }, { detail: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * The values of a project's settings as rows of its level: what the project has of its own, `undefined` where it
 * inherits. `written` — the entry as it is in the file, whose by-provider entries the settings leave out go.
 */
export function projectSettingValues(settings: ProjectSettings, written: Record<string, unknown> = {}): FormValue[] {
  const value = (group: keyof ProjectSettings, key: string, own: unknown, fallback?: unknown): FormValue => ({ group, key, qualifier: '', value: own, fallback })
  const byProvider = (key: 'models' | 'accounts'): FormValue[] => {
    const names = settings[key]
    const providers = new Set([...Object.keys(isPlainObject(written[key]) ? written[key] : {}), ...Object.keys(names)])
    return [...providers].map((provider) => ({ group: key, key, qualifier: provider, value: names[provider]?.trim() || undefined }))
  }
  const { ci } = settings
  return [
    value('prompt', 'prompt', settings.prompt?.trim() || undefined),
    ...(['beforeStart', 'check', 'afterGreen'] as const).map((key) =>
      value(key, `commands.${key}`, settings[key].map((line) => line.trim()).filter((line) => line !== ''), []),
    ),
    value('ci', 'ci.guard', ci.guard, true),
    value('ci', 'ci.kinds', CI_KINDS.filter((kind) => ci.kinds.includes(kind)), [...CI_KINDS]),
    value('ci', 'ci.waitMinutes', ci.waitMinutes, null),
    value('ci', 'ci.recheckMain', ci.recheckMain, true),
    value('ci', 'ci.fixTask', ci.fixTask, false),
    value('remoteProfiles', 'remoteProfiles', settings.remoteProfiles, {}),
    value('pullRequests', 'pullRequests', settings.pullRequests, false),
    value('fillMilestone', 'fillMilestone', settings.fillMilestone, false),
    value('changelog', 'changelog', settings.changelog, DEFAULT_CHANGELOG),
    value('provider', 'provider', settings.provider ?? undefined),
    ...byProvider('models'),
    ...byProvider('accounts'),
    value('modelLabels', 'modelLabels', settings.modelLabels ?? undefined),
  ]
}

/**
 * The project's entry in the config file with `branch`, `prompt`, `commands`, `ci`, `fillMilestone`, `provider`, `models`,
 * `accounts` and `modelLabels` set, or removed when empty or inherited; its other keys stay, and so do the settings
 * `changed` leaves out.
 */
export function withProjectSettings(
  entry: unknown,
  settings: ProjectSettings,
  changed: (field: keyof ProjectSettings) => boolean = () => true,
): Record<string, unknown> {
  const fields: Record<string, unknown> = isPlainObject(entry) ? { ...entry } : { repo: entry }
  const next = writeRows(fields, changesOf(null, projectSettingValues(settings, fields), (group) => changed(group as keyof ProjectSettings)))
  const name = settings.branch.trim()
  if (changed('branch') && name === DEFAULT_BRANCH) delete next.branch
  else if (changed('branch')) next.branch = name
  return next
}
