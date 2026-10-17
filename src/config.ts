import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { refuseNewer } from './storage/schema.js'
import { DEFAULT_RULES, sameName, type ChainRules } from './chain/rules.js'
import { isLanguage, LANGUAGES, type Language } from './language.js'
import { fail } from './notice/notice.js'
import { CODEX_ACCOUNT, GLOBAL_ACCOUNT, type PoolEntry } from './account/model.js'
import { DEFAULT_PROVIDER, EXECUTION_MODES, isProvider, PROVIDERS } from './agent/providers.js'
import type { RunSettings } from './sessions/launch.js'
import { placeholderIn } from './sessions/prompt.js'
import type { CacheTtl, CiSettings, ContextScale, ProjectSettings, StatsConfig } from './state.js'
import { CI_KINDS, type CiKind } from './ci/model.js'
import { CLAUDE } from './claude/name.js'
import { CODEX } from './codex/name.js'
import type { CompareSettings } from './stats/rules.js'
import { DEFAULT_HIDDEN_SKILLS } from './tools/settings.js'
import { ADAPTERS, DEFAULT_TRACKER } from './tracker/adapters.js'
import type { TrackerAdapter } from './tracker/source.js'
import { compareVersions, DEFAULT_UPDATES, type UpdateSettings } from './updates/release.js'

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
  tracker: string
  trackers: Record<string, string>
  trackerProjects: Record<string, string>
  /** The shared `brief`; `briefs` — what each project ends up with. */
  brief: boolean
  briefs: Record<string, boolean>
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
  updates: UpdateSettings
}

const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,4}$/
export const RULE_KEYS = ['active', 'terminal', 'requiredLabels', 'excludedLabels'] as const
const COMMAND_KEYS = ['beforeStart', 'check', 'afterGreen'] as const
const RESTART_KEYS = ['projects', 'slots', 'tracker', 'trackers', 'trackerProjects', 'context'] as const
/** Keys an older config had; the address now comes from `EVEN_KEEL_HOST` and `EVEN_KEEL_PORT`. */
const IGNORED_KEYS = ['host', 'port'] as const
export const DEFAULT_BRANCH = 'main'
/**
 * Claude's model unless the config names one: without `--model` the CLI takes it from `settings.json`, which an editor
 * may have just changed. Codex has none: its own config's model.
 */
export const DEFAULT_MODELS: Readonly<Record<string, string>> = { [CLAUDE]: 'opus' }
export const DEFAULT_ACCOUNTS: Readonly<Record<string, string>> = { [CLAUDE]: GLOBAL_ACCOUNT, [CODEX]: CODEX_ACCOUNT }
export const DEFAULT_EXECUTION: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EXECUTION_MODES).map(([provider, modes]) => [provider, modes[0]!]),
)
export const CONFIG_FILE = 'even-keel.config.json'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 4747
// What `git check-ref-format --branch` refuses, short of the rarest cases.
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*@\{)(?!.*\/\/)(?!.*\/\.)(?!\.)[^\s~^:?*[\\\x00-\x1f\x7f]+(?<![/.])(?<!\.lock)$/
export const DEFAULT_LANGUAGE: Language = 'en'
export const DEFAULT_CONTEXT: Readonly<ContextScale> = { window: 600_000, warn: 50, danger: 80 }
export const DEFAULT_COMPARE: Readonly<CompareSettings> = { minTasks: 5, minSessions: 10, days: 7 }
const COMPARE_LIMITS: Record<keyof CompareSettings, number> = { minTasks: 10_000, minSessions: 10_000, days: 365 }
/** The checkpoint hook asks the service for its threshold only from this context size on. */
const CHECKPOINT_ASK_FROM = 100_000

type AdapterShapes = Readonly<Record<string, Pick<TrackerAdapter, 'projectKey'>>>

export function parseConfig(raw: unknown, adapters: AdapterShapes = ADAPTERS): EvenKeelConfig {
  const input = (raw ?? {}) as Partial<Record<keyof EvenKeelConfig | 'version', unknown>>
  parseVersion(input.version)
  if (!Array.isArray(input.projects)) throw fail('config.projects', {})
  const { chain: shared, tracker: sharedTracker, brief: sharedBrief } = parseShared(input, adapters)
  const language = parseLanguage(input.language, 'language')
  const projects: Record<string, string> = {}
  const ids: Record<string, string> = {}
  const names: Record<string, string> = {}
  const rules: Record<string, ChainRules> = {}
  const slots: Record<string, number> = {}
  const trackers: Record<string, string> = {}
  const trackerProjects: Record<string, string> = {}
  const briefs: Record<string, boolean> = {}
  const settings: Record<string, ProjectSettings> = {}
  const placeOf: Record<string, string> = {}
  for (const [index, fields] of (input.projects as unknown[]).entries()) {
    const place = `projects[${index}]`
    if (!isPlainObject(fields)) throw fail('config.projectEntry', { where: place })
    const { id, key, repo, name, branch, chain, slot, tracker, brief, prompt, commands, ci, fillMilestone, provider, models, accounts, modelLabels } = fields
    if (typeof key !== 'string' || !PROJECT_KEY.test(key)) throw fail('config.projectKey', { where: `${place}.key`, value: String(JSON.stringify(key)) })
    if (typeof id !== 'string' || id.trim() === '') throw fail('config.projectId', { where: `${place}.id` })
    for (const [field, value] of [['key', key], ['id', id]] as const) {
      const first = placeOf[`${field}:${value}`]
      if (first !== undefined) throw fail('config.projectTwice', { field, value: JSON.stringify(value), first, second: place })
      placeOf[`${field}:${value}`] = place
    }
    ids[key] = id
    if (typeof repo !== 'string' || repo === '') throw fail('config.repoEmpty', { key })
    if (slot !== undefined && typeof slot !== 'boolean' && !(Number.isInteger(slot) && (slot as number) > 0)) throw fail('config.slot', { key })
    if (name !== undefined && typeof name !== 'string') throw fail('config.projectName', { where: `${key}.name` })
    projects[key] = repo
    if (typeof name === 'string' && name.trim() !== '') names[key] = name.trim()
    if (slot === true || typeof slot === 'number') slots[key] = slot === true ? 1 : slot
    rules[key] = checkRules({ ...shared, ...parseRules(chain, `${key}.chain`) }, key)
    trackers[key] = tracker === undefined ? sharedTracker : parseTracker(tracker, `${key}.tracker`, Object.keys(adapters))
    const projectKey = adapters[trackers[key]]?.projectKey
    if (projectKey !== undefined && !(projectKey.optional && fields[projectKey.key] === undefined)) trackerProjects[key] =parseTrackerProject(fields[projectKey.key], `${key}.${projectKey.key}`, projectKey)
    briefs[key] = brief === undefined ? sharedBrief : parseBrief(brief, `${key}.brief`)
    settings[key] = {
      branch: parseBranch(branch, `${key}.branch`),
      prompt: parseProjectPrompt(prompt, `${key}.prompt`),
      ...parseCommands(commands, `${key}.commands`),
      ci: parseCi(ci, `${key}.ci`),
      fillMilestone: fillMilestone === undefined ? false : parseBrief(fillMilestone, `${key}.fillMilestone`),
      provider: provider === undefined ? null : parseProvider(provider, `${key}.provider`),
      models: parseByProvider(models, `${key}.models`),
      accounts: parseByProvider(accounts, `${key}.accounts`),
      modelLabels: modelLabels === undefined ? null : parseBrief(modelLabels, `${key}.modelLabels`),
    }
  }

  return {
    allowedHosts: parseAllowedHosts(input.allowedHosts),
    projects,
    ids,
    names,
    chain: shared,
    rules,
    slots,
    tracker: sharedTracker,
    trackers,
    trackerProjects,
    brief: sharedBrief,
    briefs,
    settings,
    context: parseContext(input.context),
    provider: input.provider === undefined ? DEFAULT_PROVIDER : parseProvider(input.provider, 'provider'),
    models: { ...DEFAULT_MODELS, ...parseByProvider(input.models, 'models') },
    accounts: { ...DEFAULT_ACCOUNTS, ...parseByProvider(input.accounts, 'accounts') },
    execution: { ...DEFAULT_EXECUTION, ...parseExecution(input.execution) },
    modelLabels: input.modelLabels === undefined ? false : parseBrief(input.modelLabels, 'modelLabels'),
    modelPrompts: parseModelPrompts(input.modelPrompts),
    stats: parseStats(input.stats),
    language,
    promptLanguage: parseLanguage(input.promptLanguage, 'promptLanguage') ?? language ?? DEFAULT_LANGUAGE,
    hiddenSkills: parseHiddenSkills(input.hiddenSkills),
    cacheTtl: parseCacheTtl(input.cacheTtl),
    parallel: parseParallel(input.parallel),
    updates: parseUpdates(input.updates),
  }
}

/** The shared keys a project inherits unless it sets its own. */
export function parseShared(raw: unknown, adapters: AdapterShapes = ADAPTERS): Pick<EvenKeelConfig, 'chain' | 'tracker' | 'brief'> {
  const input = (isPlainObject(raw) ? raw : {}) as Partial<Record<keyof EvenKeelConfig, unknown>>
  return {
    chain: { ...DEFAULT_RULES, ...parseRules(input.chain, 'chain') },
    tracker: parseTracker(input.tracker ?? DEFAULT_TRACKER, 'tracker', Object.keys(adapters)),
    brief: parseBrief(input.brief ?? true, 'brief'),
  }
}

function parseVersion(raw: unknown): void {
  if (raw === undefined) return
  if (!Number.isInteger(raw) || (raw as number) < 1) throw fail('config.version', { value: String(JSON.stringify(raw)) })
  refuseNewer(CONFIG_FILE, raw as number)
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

function parseParallel(raw: unknown): number {
  if (raw === undefined) return 1
  if (!Number.isInteger(raw) || (raw as number) < 1) throw fail('config.parallel', { value: String(JSON.stringify(raw)) })
  return raw as number
}

function parseUpdates(raw: unknown): UpdateSettings {
  if (raw === undefined) return { ...DEFAULT_UPDATES }
  if (!isPlainObject(raw)) throw fail('config.notObject', { where: 'updates' })
  const unknown = Object.keys(raw).find((key) => !Object.hasOwn(DEFAULT_UPDATES, key))
  if (unknown !== undefined) throw fail('config.updatesKey', { key: unknown, known: Object.keys(DEFAULT_UPDATES) })
  const { check, notify, dismissed } = { ...DEFAULT_UPDATES, ...raw }
  if (dismissed !== null && (typeof dismissed !== 'string' || compareVersions(dismissed, dismissed) === null)) {
    throw fail('config.updatesDismissed', { value: String(JSON.stringify(dismissed)) })
  }
  return { check: parseBrief(check, 'updates.check'), notify: parseBrief(notify, 'updates.notify'), dismissed }
}

export function liveConfig(current: EvenKeelConfig, next: EvenKeelConfig): EvenKeelConfig {
  const keep = <T>(field: Record<string, T>, fallback: Record<string, T>) =>
    Object.fromEntries(Object.keys(current.projects).map((key) => [key, field[key] ?? fallback[key]!]))
  const { allowedHosts, names, chain, brief, provider, models, accounts, execution, modelLabels, modelPrompts, stats, language, promptLanguage, hiddenSkills, cacheTtl, parallel, updates } = next
  return {
    ...current,
    allowedHosts,
    updates,
    names,
    parallel,
    chain,
    brief,
    rules: keep(next.rules, current.rules),
    briefs: keep(next.briefs, current.briefs),
    settings: keep(next.settings, current.settings),
    provider,
    models,
    accounts,
    execution,
    modelLabels,
    modelPrompts,
    stats,
    language,
    promptLanguage,
    hiddenSkills,
    cacheTtl,
  }
}

/** Where the service listens: `EVEN_KEEL_HOST` and `EVEN_KEEL_PORT`, loopback and 4747 without them. */
export function listenOf(env: NodeJS.ProcessEnv): { host: string; port: number } {
  const host = env.EVEN_KEEL_HOST?.trim() || DEFAULT_HOST
  const text = env.EVEN_KEEL_PORT?.trim() || String(DEFAULT_PORT)
  const port = /^\d+$/.test(text) ? Number(text) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('config.port', { value: text })
  return { host, port }
}

/** The keys of the raw config that are no longer read. */
export function ignoredKeys(raw: unknown): string[] {
  return isPlainObject(raw) ? IGNORED_KEYS.filter((key) => Object.hasOwn(raw, key)) : []
}

function parseBranch(raw: unknown, where: string): string {
  if (raw === undefined) return DEFAULT_BRANCH
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!BRANCH.test(name)) throw fail('config.branch', { where, value: String(JSON.stringify(raw)) })
  return name
}

function parseAllowedHosts(raw: unknown): string[] {
  if (raw === undefined) return []
  const names = Array.isArray(raw) ? raw.map((name) => (typeof name === 'string' ? name.trim().toLowerCase() : '')) : ['']
  if (names.some((name) => name === '' || /[/\\@?#\s]/.test(name))) throw fail('config.allowedHosts', {})
  return names
}

function parseHiddenSkills(raw: unknown): string[] {
  if (raw === undefined) return [...DEFAULT_HIDDEN_SKILLS]
  if (!Array.isArray(raw) || raw.some((name) => typeof name !== 'string' || name.trim() === '')) throw fail('config.hiddenSkills', {})
  return raw.map((name: string) => name.trim())
}

function parseCacheTtl(raw: unknown): CacheTtl | null {
  if (raw === undefined || raw === null) return null
  if (raw !== '5m' && raw !== '1h') throw fail('config.cacheTtl', { value: String(JSON.stringify(raw)) })
  return raw
}

function parseLanguage(raw: unknown, where: string): Language | null {
  if (raw === undefined) return null
  if (!isLanguage(raw)) throw fail('config.language', { where, value: String(JSON.stringify(raw)), known: [...LANGUAGES] })
  return raw
}

export function restartChanges(current: EvenKeelConfig, next: EvenKeelConfig): string[] {
  return RESTART_KEYS.filter((key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]))
}

function parseTracker(raw: unknown, where: string, adapters: string[]): string {
  if (typeof raw !== 'string' || raw.trim() === '') throw fail('config.trackerName', { where })
  const name = raw.trim().toLowerCase()
  if (!adapters.includes(name)) throw fail('config.trackerUnknown', { where, name, known: adapters })
  return name
}

function parseTrackerProject(raw: unknown, where: string, { pattern, example }: NonNullable<TrackerAdapter['projectKey']>): string {
  if (typeof raw !== 'string' || !pattern.test(raw.trim())) throw fail('config.trackerProject', { where, example })
  return raw.trim()
}

function parseBrief(raw: unknown, where: string): boolean {
  if (typeof raw !== 'boolean') throw fail('config.brief', { where })
  return raw
}

function parseProvider(raw: unknown, where: string): string {
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!isProvider(name)) throw fail('config.provider', { where, value: String(JSON.stringify(raw)), known: [...PROVIDERS] })
  return name
}

/** `models` or `accounts`: a name by provider, blanks left out. */
function parseByProvider(raw: unknown, where: string): Record<string, string> {
  if (raw === undefined) return {}
  if (!isPlainObject(raw)) throw fail('config.notObject', { where })
  const names: Record<string, string> = {}
  for (const [provider, name] of Object.entries(raw)) {
    if (!isProvider(provider)) throw fail('config.providerKey', { where, key: provider, known: [...PROVIDERS] })
    if (typeof name !== 'string') throw fail('config.providerName', { where: `${where}.${provider}` })
    if (name.trim() !== '') names[provider] = name.trim()
  }
  return names
}

function parseExecution(raw: unknown): Record<string, string> {
  if (raw === undefined) return {}
  if (!isPlainObject(raw)) throw fail('config.notObject', { where: 'execution' })
  const modes: Record<string, string> = {}
  for (const [provider, mode] of Object.entries(raw)) {
    const known = EXECUTION_MODES[provider]
    if (known === undefined) throw fail('config.providerKey', { where: 'execution', key: provider, known: Object.keys(EXECUTION_MODES) })
    if (typeof mode !== 'string' || !known.includes(mode)) throw fail('config.execution', { provider, value: String(JSON.stringify(mode)), known: [...known] })
    modes[provider] = mode
  }
  return modes
}

/** What the project's sessions run on: its own provider, models, accounts and labels switch over the shared ones. */
export function runSettings(config: Pick<EvenKeelConfig, 'settings' | 'provider' | 'models' | 'accounts' | 'modelLabels'>, project: string | undefined): RunSettings {
  const own = project === undefined ? undefined : config.settings[project]
  return {
    provider: own?.provider ?? config.provider,
    models: { ...config.models, ...own?.models },
    accounts: { ...config.accounts, ...own?.accounts },
    labels: own?.modelLabels ?? config.modelLabels,
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

function parseProjectPrompt(raw: unknown, where: string): string | null {
  if (raw === undefined) return null
  if (typeof raw !== 'string') throw fail('config.projectPrompt', { where })
  return raw.trim() === '' ? null : raw.trim()
}

export const DEFAULT_CI: Readonly<CiSettings> = Object.freeze({
  guard: true,
  kinds: Object.freeze([...CI_KINDS]) as CiKind[],
  waitMinutes: null,
  recheckMain: true,
  fixTask: false,
})
const CI_KEYS = ['guard', 'kinds', 'waitMinutes', 'recheckMain', 'fixTask'] as const

function parseCi(raw: unknown, where: string): CiSettings {
  if (raw === undefined) return DEFAULT_CI
  if (!isPlainObject(raw)) throw fail('config.notObject', { where })
  const unknown = Object.keys(raw).find((key) => !(CI_KEYS as readonly string[]).includes(key))
  if (unknown !== undefined) throw fail('config.ciKey', { where, key: unknown, known: [...CI_KEYS] })
  const { guard = true, kinds = DEFAULT_CI.kinds, waitMinutes = null, recheckMain = true, fixTask = false } = raw
  if (typeof guard !== 'boolean') throw fail('config.brief', { where: `${where}.guard` })
  if (!Array.isArray(kinds) || kinds.some((kind) => !(CI_KINDS as readonly unknown[]).includes(kind))) {
    throw fail('config.ciKinds', { where: `${where}.kinds`, known: [...CI_KINDS] })
  }
  if (waitMinutes !== null && !(Number.isInteger(waitMinutes) && (waitMinutes as number) >= 0)) throw fail('config.ciWait', { where: `${where}.waitMinutes` })
  if (typeof recheckMain !== 'boolean') throw fail('config.brief', { where: `${where}.recheckMain` })
  if (typeof fixTask !== 'boolean') throw fail('config.brief', { where: `${where}.fixTask` })
  return { guard, kinds: CI_KINDS.filter((kind) => kinds.includes(kind)), waitMinutes: waitMinutes as number | null, recheckMain, fixTask }
}

// An object rather than a list, so each moment of a task gets its own key: `beforeStart`, `check`, `afterGreen`.
function parseCommands(raw: unknown, where: string): Record<(typeof COMMAND_KEYS)[number], string[]> {
  const commands = { beforeStart: [] as string[], check: [] as string[], afterGreen: [] as string[] }
  if (raw === undefined) return commands
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw fail('config.notObject', { where })
  for (const [key, value] of Object.entries(raw)) {
    if (!(COMMAND_KEYS as readonly string[]).includes(key)) throw fail('config.commandKey', { where, key, known: [...COMMAND_KEYS] })
    if (!Array.isArray(value) || value.some((line) => typeof line !== 'string')) throw fail('config.commandList', { where: `${where}.${key}` })
    commands[key as (typeof COMMAND_KEYS)[number]] = value.map((line: string) => line.trim()).filter((line) => line !== '')
  }
  return commands
}

function parseRules(raw: unknown, where: string): Partial<ChainRules> {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw fail('config.notObject', { where })
  const rules: Partial<ChainRules> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(RULE_KEYS as readonly string[]).includes(key)) throw fail('config.ruleKey', { where, key })
    // A project goes back to the categories of its statuses over a shared list.
    if (value === null && (key === 'active' || key === 'terminal')) {
      rules[key] = null
      continue
    }
    if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || name.trim() === '')) throw fail('config.ruleList', { where, key })
    rules[key as (typeof RULE_KEYS)[number]] = value.map((name: string) => name.trim())
  }
  return rules
}

function checkRules(rules: ChainRules, project: string): ChainRules {
  const clash = (a: string[], b: string[]) => a.find((name) => b.some((other) => sameName(name, other)))
  const status = clash(rules.active ?? [], rules.terminal ?? [])
  if (status !== undefined) throw fail('config.statusBoth', { project, status })
  const label = clash(rules.requiredLabels, rules.excludedLabels)
  if (label !== undefined) throw fail('config.labelBoth', { project, label })
  return rules
}

function parseModelPrompts(raw: unknown): Record<string, string> {
  if (raw === undefined) return {}
  if (!isPlainObject(raw)) throw fail('config.modelPrompts', {})
  const prompts: Record<string, string> = {}
  for (const [model, text] of Object.entries(raw)) {
    if (model.trim() === '') throw fail('config.modelPrompts', {})
    if (typeof text !== 'string' || text.trim() === '') throw fail('config.modelPromptEmpty', { model })
    const placeholder = placeholderIn(text)
    if (placeholder !== null) throw fail('config.modelPromptPlaceholder', { model, placeholder })
    prompts[model.trim()] = text.trim()
  }
  return prompts
}

function parseContext(raw: unknown): ContextScale {
  if (raw === undefined) return { ...DEFAULT_CONTEXT }
  if (typeof raw !== 'object' || raw === null) throw fail('config.notObject', { where: 'context' })
  const { window, warn, danger } = { ...DEFAULT_CONTEXT, ...(raw as Partial<ContextScale>) }
  if (typeof window !== 'number' || !Number.isInteger(window) || window < 1) throw fail('config.contextWindow', { value: String(window) })
  const percent = (value: unknown) => typeof value === 'number' && value > 0 && value <= 100
  if (!percent(warn) || !percent(danger) || warn >= danger) throw fail('config.contextPercents', {})
  return { window, warn, danger }
}

function parseStats(raw: unknown): StatsConfig {
  if (raw === undefined) return { compare: { ...DEFAULT_COMPARE }, moves: {}, otherBelow: 0, checkpointTokens: null }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw fail('config.notObject', { where: 'stats' })
  const {
    compare = {},
    moves = {},
    otherBelow = 0,
    checkpointTokens = null,
  } = raw as { compare?: unknown; moves?: unknown; otherBelow?: unknown; checkpointTokens?: unknown }
  if (typeof moves !== 'object' || moves === null || Array.isArray(moves)) throw fail('config.notObject', { where: 'stats.moves' })
  for (const [from, to] of Object.entries(moves)) {
    if (from.trim() === '' || typeof to !== 'string' || to.trim() === '') throw fail('config.statsMove', { from })
  }
  if (typeof otherBelow !== 'number' || !Number.isFinite(otherBelow) || otherBelow < 0) {
    throw fail('config.otherBelow', { value: String(JSON.stringify(otherBelow)) })
  }
  if (checkpointTokens !== null && (!Number.isInteger(checkpointTokens) || (checkpointTokens as number) < CHECKPOINT_ASK_FROM)) {
    throw fail('config.checkpointTokens', { from: CHECKPOINT_ASK_FROM, value: String(JSON.stringify(checkpointTokens)) })
  }
  return { compare: parseCompare(compare), moves: moves as Record<string, string>, otherBelow, checkpointTokens: checkpointTokens as number | null }
}

function parseCompare(compare: unknown): CompareSettings {
  if (typeof compare !== 'object' || compare === null || Array.isArray(compare)) throw fail('config.notObject', { where: 'stats.compare' })
  const settings = { ...DEFAULT_COMPARE }
  for (const [key, value] of Object.entries(compare)) {
    const limit = COMPARE_LIMITS[key as keyof CompareSettings]
    if (limit === undefined) throw fail('config.compareKey', { key })
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > limit) {
      throw fail('config.compareValue', { key, limit, value: String(value) })
    }
    settings[key as keyof CompareSettings] = value
  }
  return settings
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
 * The project's entry in the config file with `branch`, `prompt`, `commands`, `ci`, `fillMilestone`, `provider`, `models`,
 * `accounts` and `modelLabels` set, or removed when empty or inherited; its other keys stay, and so do the settings
 * `changed` leaves out.
 */
export function withProjectSettings(
  entry: unknown,
  { branch, prompt, beforeStart, check, afterGreen, ci, fillMilestone, provider, models, accounts, modelLabels }: ProjectSettings,
  changed: (field: keyof ProjectSettings) => boolean = () => true,
): Record<string, unknown> {
  const fields: Record<string, unknown> = isPlainObject(entry) ? { ...entry } : { repo: entry }
  const commands: Record<string, unknown> = isPlainObject(fields.commands) ? { ...fields.commands } : {}
  /** Sets the key, or removes it when `undefined`. */
  const put = (into: Record<string, unknown>, key: string, value: unknown) => {
    if (value === undefined) delete into[key]
    else into[key] = value
  }

  const name = branch.trim()
  if (changed('branch')) put(fields, 'branch', name === DEFAULT_BRANCH ? undefined : name)
  if (changed('prompt')) put(fields, 'prompt', prompt?.trim() || undefined)
  for (const [key, list] of [['beforeStart', beforeStart], ['check', check], ['afterGreen', afterGreen]] as const) {
    const lines = list.map((line) => line.trim()).filter((line) => line !== '')
    if (changed(key)) put(commands, key, lines.length === 0 ? undefined : lines)
  }
  if (COMMAND_KEYS.some(changed)) put(fields, 'commands', Object.keys(commands).length === 0 ? undefined : commands)
  if (changed('ci')) {
    const kinds = CI_KINDS.filter((kind) => ci.kinds.includes(kind))
    const written = {
      ...(ci.guard ? {} : { guard: false }),
      ...(kinds.length === CI_KINDS.length ? {} : { kinds }),
      ...(ci.waitMinutes === null ? {} : { waitMinutes: ci.waitMinutes }),
      ...(ci.recheckMain ? {} : { recheckMain: false }),
      ...(ci.fixTask ? { fixTask: true } : {}),
    }
    put(fields, 'ci', Object.keys(written).length === 0 ? undefined : written)
  }
  if (changed('fillMilestone')) put(fields, 'fillMilestone', fillMilestone || undefined)
  if (changed('provider')) put(fields, 'provider', provider ?? undefined)
  for (const [key, names] of [['models', models], ['accounts', accounts]] as const) {
    const kept = Object.entries(names).flatMap(([each, name]) => (name.trim() === '' ? [] : [[each, name.trim()]]))
    if (changed(key)) put(fields, key, kept.length === 0 ? undefined : Object.fromEntries(kept))
  }
  if (changed('modelLabels')) put(fields, 'modelLabels', modelLabels ?? undefined)
  return fields
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
