import { readFileSync } from 'node:fs'
import { DEFAULT_RULES, sameName, type ChainRules } from './chain/rules.js'
import { isLanguage, LANGUAGES, type Language } from './language.js'
import { fail } from './notice/notice.js'
import { isModelAlias, MODEL_ALIASES, type ModelAlias } from './tracker/model.js'
import { placeholderIn } from './sessions/prompt.js'
import type { ContextScale, ProjectSettings } from './state.js'
import type { CompareSettings } from './stats/rules.js'
import { DEFAULT_HIDDEN_SKILLS } from './tools/settings.js'
import { ADAPTERS, DEFAULT_TRACKER } from './tracker/adapters.js'
import type { TrackerAdapter } from './tracker/source.js'

export interface EvenKeelConfig {
  host: string
  port: number
  projects: Record<string, string>
  rules: Record<string, ChainRules>
  slots: Record<string, number>
  tracker: string
  trackers: Record<string, string>
  trackerProjects: Record<string, string>
  briefs: Record<string, boolean>
  settings: Record<string, ProjectSettings>
  context: ContextScale
  model: ModelAlias
  modelPrompts: Partial<Record<ModelAlias, string>>
  stats: StatsConfig
  language: Language | null
  promptLanguage: Language
  /** Skills chain sessions get only for `/name` while trimming is on. */
  hiddenSkills: string[]
  /** Chains run at once; the rest wait in the queue. */
  parallel: number
}

export interface StatsConfig {
  compare: CompareSettings
  /** Old folder → new folder: sessions in the old one count where it lives now. */
  moves: Record<string, string>
  /** A folder group costing less than this in all goes to Other on /stats. */
  otherBelow: number
  /** The checkpoint hook's first threshold for every project; null leaves it to the calibration. */
  checkpointTokens: number | null
}

const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,4}$/
const RULE_KEYS = ['active', 'terminal', 'requiredLabels', 'excludedLabels'] as const
const COMMAND_KEYS = ['beforeStart'] as const
const RESTART_KEYS = ['host', 'port', 'projects', 'slots', 'tracker', 'trackers', 'trackerProjects', 'context'] as const
const DEFAULT_LANGUAGE: Language = 'en'
const DEFAULT_MODEL: ModelAlias = 'opus'
const DEFAULT_CONTEXT: ContextScale = { window: 600_000, warn: 50, danger: 80 }
const DEFAULT_COMPARE: CompareSettings = { minTasks: 5, minSessions: 10, days: 7 }
const COMPARE_LIMITS: Record<keyof CompareSettings, number> = { minTasks: 10_000, minSessions: 10_000, days: 365 }
/** The checkpoint hook asks the service for its threshold only from this context size on. */
const CHECKPOINT_ASK_FROM = 100_000

type AdapterShapes = Readonly<Record<string, Pick<TrackerAdapter, 'projectKey'>>>

export function parseConfig(raw: unknown, adapters: AdapterShapes = ADAPTERS): EvenKeelConfig {
  const input = (raw ?? {}) as Partial<Record<keyof EvenKeelConfig | 'chain' | 'tracker' | 'brief', unknown>>

  const host = input.host ?? '0.0.0.0'
  if (typeof host !== 'string' || host === '') throw fail('config.host', {})

  const port = input.port ?? 4747
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) throw fail('config.port', { value: String(port) })

  if (typeof input.projects !== 'object' || input.projects === null) throw fail('config.projects', {})
  const shared = { ...DEFAULT_RULES, ...parseRules(input.chain, 'chain') }
  const sharedTracker = parseTracker(input.tracker ?? DEFAULT_TRACKER, 'tracker', Object.keys(adapters))
  const sharedBrief = parseBrief(input.brief ?? true, 'brief')
  const language = parseLanguage(input.language, 'language')
  const projects: Record<string, string> = {}
  const rules: Record<string, ChainRules> = {}
  const slots: Record<string, number> = {}
  const trackers: Record<string, string> = {}
  const trackerProjects: Record<string, string> = {}
  const briefs: Record<string, boolean> = {}
  const settings: Record<string, ProjectSettings> = {}
  for (const [key, entry] of Object.entries(input.projects)) {
    if (!PROJECT_KEY.test(key)) throw fail('config.projectKey', { key })
    const fields: Record<string, unknown> = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : { repo: entry }
    const { repo, chain, slot, tracker, brief, prompt, commands } = fields
    if (typeof repo !== 'string' || repo === '') throw fail('config.repoEmpty', { key })
    if (slot !== undefined && typeof slot !== 'boolean' && !(Number.isInteger(slot) && (slot as number) > 0)) throw fail('config.slot', { key })
    projects[key] = repo
    if (slot === true || typeof slot === 'number') slots[key] = slot === true ? 1 : slot
    rules[key] = checkRules({ ...shared, ...parseRules(chain, `${key}.chain`) }, key)
    trackers[key] = tracker === undefined ? sharedTracker : parseTracker(tracker, `${key}.tracker`, Object.keys(adapters))
    const projectKey = adapters[trackers[key]]?.projectKey
    if (projectKey !== undefined && !(projectKey.optional && fields[projectKey.key] === undefined)) trackerProjects[key] =parseTrackerProject(fields[projectKey.key], `${key}.${projectKey.key}`, projectKey)
    briefs[key] = brief === undefined ? sharedBrief : parseBrief(brief, `${key}.brief`)
    settings[key] = { prompt: parseProjectPrompt(prompt, `${key}.prompt`), beforeStart: parseCommands(commands, `${key}.commands`).beforeStart }
  }

  return {
    host,
    port,
    projects,
    rules,
    slots,
    tracker: sharedTracker,
    trackers,
    trackerProjects,
    briefs,
    settings,
    context: parseContext(input.context),
    model: parseModel(input.model),
    modelPrompts: parseModelPrompts(input.modelPrompts),
    stats: parseStats(input.stats),
    language,
    promptLanguage: parseLanguage(input.promptLanguage, 'promptLanguage') ?? language ?? DEFAULT_LANGUAGE,
    hiddenSkills: parseHiddenSkills(input.hiddenSkills),
    parallel: parseParallel(input.parallel),
  }
}

function parseParallel(raw: unknown): number {
  if (raw === undefined) return 1
  if (!Number.isInteger(raw) || (raw as number) < 1) throw fail('config.parallel', { value: String(JSON.stringify(raw)) })
  return raw as number
}

export function liveConfig(current: EvenKeelConfig, next: EvenKeelConfig): EvenKeelConfig {
  const keep = <T>(field: Record<string, T>, fallback: Record<string, T>) =>
    Object.fromEntries(Object.keys(current.projects).map((key) => [key, field[key] ?? fallback[key]!]))
  const { model, modelPrompts, stats, language, promptLanguage, hiddenSkills, parallel } = next
  return {
    ...current,
    parallel,
    rules: keep(next.rules, current.rules),
    briefs: keep(next.briefs, current.briefs),
    settings: keep(next.settings, current.settings),
    model,
    modelPrompts,
    stats,
    language,
    promptLanguage,
    hiddenSkills,
  }
}

function parseHiddenSkills(raw: unknown): string[] {
  if (raw === undefined) return [...DEFAULT_HIDDEN_SKILLS]
  if (!Array.isArray(raw) || raw.some((name) => typeof name !== 'string' || name.trim() === '')) throw fail('config.hiddenSkills', {})
  return raw.map((name: string) => name.trim())
}

function parseModel(raw: unknown): ModelAlias {
  if (raw === undefined) return DEFAULT_MODEL
  const model = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!isModelAlias(model)) throw fail('config.model', { value: String(JSON.stringify(raw)), known: [...MODEL_ALIASES] })
  return model
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

function parseProjectPrompt(raw: unknown, where: string): string | null {
  if (raw === undefined) return null
  if (typeof raw !== 'string') throw fail('config.projectPrompt', { where })
  return raw.trim() === '' ? null : raw.trim()
}

// An object rather than a list, so commands after the agent's work get a key of their own next to `beforeStart`.
function parseCommands(raw: unknown, where: string): { beforeStart: string[] } {
  if (raw === undefined) return { beforeStart: [] }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw fail('config.notObject', { where })
  const commands = { beforeStart: [] as string[] }
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

function parseModelPrompts(raw: unknown): Partial<Record<ModelAlias, string>> {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null) throw fail('config.modelPrompts', {})
  const prompts: Partial<Record<ModelAlias, string>> = {}
  for (const [model, text] of Object.entries(raw)) {
    if (!isModelAlias(model)) throw fail('config.modelAlias', { model })
    if (typeof text !== 'string' || text.trim() === '') throw fail('config.modelPromptEmpty', { model })
    const placeholder = placeholderIn(text)
    if (placeholder !== null) throw fail('config.modelPromptPlaceholder', { model, placeholder })
    prompts[model] = text.trim()
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

export function loadConfig(file: string): EvenKeelConfig {
  return parseConfig(readRawConfig(file))
}

export function readRawConfig(file: string): unknown {
  const text = readFileSync(file, 'utf8')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw fail('config.notJson', { file }, { detail: error instanceof Error ? error.message : String(error) })
  }
}

/** The project's entry in the config file with `prompt` and `commands.beforeStart` set, or removed when empty; its other keys stay. */
export function withProjectSettings(entry: unknown, { prompt, beforeStart }: ProjectSettings): Record<string, unknown> {
  const fields: Record<string, unknown> = isPlainObject(entry) ? { ...entry } : { repo: entry }
  const text = prompt?.trim() ?? ''
  if (text === '') delete fields.prompt
  else fields.prompt = text
  const commands: Record<string, unknown> = isPlainObject(fields.commands) ? { ...fields.commands } : {}
  const lines = beforeStart.map((line) => line.trim()).filter((line) => line !== '')
  if (lines.length === 0) delete commands.beforeStart
  else commands.beforeStart = lines
  if (Object.keys(commands).length === 0) delete fields.commands
  else fields.commands = commands
  return fields
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
