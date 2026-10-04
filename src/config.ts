import { readFileSync } from 'node:fs'
import { DEFAULT_RULES, sameName, type ChainRules } from './chain/rules.js'
import { isModelAlias, type ModelAlias } from './tracker/model.js'
import { placeholderIn } from './sessions/prompt.js'
import type { ContextScale } from './state.js'
import type { CompareSettings } from './stats/rules.js'
import { ADAPTERS, DEFAULT_TRACKER } from './tracker/adapters.js'

export interface BatonConfig {
  host: string
  port: number
  projects: Record<string, string>
  rules: Record<string, ChainRules>
  slots: Record<string, number>
  tracker: string
  trackers: Record<string, string>
  context: ContextScale
  modelPrompts: Partial<Record<ModelAlias, string>>
  stats: StatsConfig
}

export interface StatsConfig {
  compare: CompareSettings
}

const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,4}$/
const RULE_KEYS = ['active', 'terminal', 'requiredLabels', 'excludedLabels'] as const
const RESTART_KEYS = ['host', 'port', 'projects', 'slots', 'tracker', 'trackers', 'context'] as const
const DEFAULT_CONTEXT: ContextScale = { window: 600_000, warn: 50, danger: 80 }
const DEFAULT_COMPARE: CompareSettings = { minTasks: 5, minSessions: 10, days: 7 }
const COMPARE_LIMITS: Record<keyof CompareSettings, number> = { minTasks: 10_000, minSessions: 10_000, days: 365 }

export function parseConfig(raw: unknown, adapters: string[] = Object.keys(ADAPTERS)): BatonConfig {
  const input = (raw ?? {}) as Partial<Record<keyof BatonConfig | 'chain' | 'tracker', unknown>>

  const host = input.host ?? '0.0.0.0'
  if (typeof host !== 'string' || host === '') throw new Error('config: host must be a non-empty string')

  const port = input.port ?? 4747
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`config: port must be an integer in 1..65535, got ${String(port)}`)
  }

  if (typeof input.projects !== 'object' || input.projects === null) {
    throw new Error('config: projects must map a project key to a repository path')
  }
  const shared = { ...DEFAULT_RULES, ...parseRules(input.chain, 'chain') }
  const sharedTracker = parseTracker(input.tracker ?? DEFAULT_TRACKER, 'tracker', adapters)
  const projects: Record<string, string> = {}
  const rules: Record<string, ChainRules> = {}
  const slots: Record<string, number> = {}
  const trackers: Record<string, string> = {}
  for (const [key, entry] of Object.entries(input.projects)) {
    if (!PROJECT_KEY.test(key)) throw new Error(`config: "${key}" is not a project key`)
    const { repo, chain, slot, tracker } =
      typeof entry === 'object' && entry !== null
        ? (entry as { repo?: unknown; chain?: unknown; slot?: unknown; tracker?: unknown })
        : { repo: entry }
    if (typeof repo !== 'string' || repo === '') throw new Error(`config: repository path for ${key} is empty`)
    if (slot !== undefined && typeof slot !== 'boolean' && !(Number.isInteger(slot) && (slot as number) > 0)) {
      throw new Error(`config: ${key}.slot must be true, false or the number of slots`)
    }
    projects[key] = repo
    if (slot === true || typeof slot === 'number') slots[key] = slot === true ? 1 : slot
    rules[key] = checkRules({ ...shared, ...parseRules(chain, `${key}.chain`) }, key)
    trackers[key] = tracker === undefined ? sharedTracker : parseTracker(tracker, `${key}.tracker`, adapters)
  }

  return {
    host,
    port,
    projects,
    rules,
    slots,
    tracker: sharedTracker,
    trackers,
    context: parseContext(input.context),
    modelPrompts: parseModelPrompts(input.modelPrompts),
    stats: parseStats(input.stats),
  }
}

export function liveConfig(current: BatonConfig, next: BatonConfig): BatonConfig {
  const rules = Object.fromEntries(Object.keys(current.projects).map((key) => [key, next.rules[key] ?? current.rules[key]!]))
  return { ...current, rules, modelPrompts: next.modelPrompts, stats: next.stats }
}

export function restartChanges(current: BatonConfig, next: BatonConfig): string[] {
  return RESTART_KEYS.filter((key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]))
}

function parseTracker(raw: unknown, where: string, adapters: string[]): string {
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error(`config: ${where} must be the name of a tracker adapter`)
  const name = raw.trim().toLowerCase()
  if (!adapters.includes(name)) throw new Error(`config: ${where}: there is no tracker "${name}", known: ${adapters.join(', ')}`)
  return name
}

function parseRules(raw: unknown, where: string): Partial<ChainRules> {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`config: ${where} must be an object`)
  const rules: Partial<ChainRules> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(RULE_KEYS as readonly string[]).includes(key)) throw new Error(`config: ${where}.${key} is not a chain rule`)
    if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || name.trim() === '')) {
      throw new Error(`config: ${where}.${key} must be a list of non-empty names`)
    }
    rules[key as (typeof RULE_KEYS)[number]] = value.map((name: string) => name.trim())
  }
  return rules
}

function checkRules(rules: ChainRules, project: string): ChainRules {
  const clash = (a: string[], b: string[]) => a.find((name) => b.some((other) => sameName(name, other)))
  const status = clash(rules.active ?? [], rules.terminal ?? [])
  if (status !== undefined) throw new Error(`config: ${project}: status "${status}" is both active and terminal`)
  const label = clash(rules.requiredLabels, rules.excludedLabels)
  if (label !== undefined) throw new Error(`config: ${project}: label "${label}" is both required and excluded`)
  return rules
}

function parseModelPrompts(raw: unknown): Partial<Record<ModelAlias, string>> {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null) throw new Error('config: modelPrompts must map a model alias to a prompt')
  const prompts: Partial<Record<ModelAlias, string>> = {}
  for (const [model, text] of Object.entries(raw)) {
    if (!isModelAlias(model)) throw new Error(`config: modelPrompts.${model} is not a model alias`)
    if (typeof text !== 'string' || text.trim() === '') throw new Error(`config: modelPrompts.${model} is empty`)
    const placeholder = placeholderIn(text)
    if (placeholder !== null) {
      throw new Error(`config: modelPrompts.${model} has the substitution ${placeholder}, but a model prompt is passed on as it is`)
    }
    prompts[model] = text.trim()
  }
  return prompts
}

function parseContext(raw: unknown): ContextScale {
  if (raw === undefined) return { ...DEFAULT_CONTEXT }
  if (typeof raw !== 'object' || raw === null) throw new Error('config: context must be an object')
  const { window, warn, danger } = { ...DEFAULT_CONTEXT, ...(raw as Partial<ContextScale>) }
  if (typeof window !== 'number' || !Number.isInteger(window) || window < 1) {
    throw new Error(`config: context.window must be a positive integer of tokens, got ${String(window)}`)
  }
  const percent = (value: unknown) => typeof value === 'number' && value > 0 && value <= 100
  if (!percent(warn) || !percent(danger) || warn >= danger) {
    throw new Error(`config: context.warn and context.danger must be percents with 0 < warn < danger <= 100`)
  }
  return { window, warn, danger }
}

function parseStats(raw: unknown): StatsConfig {
  if (raw === undefined) return { compare: { ...DEFAULT_COMPARE } }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('config: stats must be an object')
  const compare = (raw as { compare?: unknown }).compare ?? {}
  if (typeof compare !== 'object' || compare === null || Array.isArray(compare)) throw new Error('config: stats.compare must be an object')
  const settings = { ...DEFAULT_COMPARE }
  for (const [key, value] of Object.entries(compare)) {
    const limit = COMPARE_LIMITS[key as keyof CompareSettings]
    if (limit === undefined) throw new Error(`config: stats.compare.${key} is not a comparison setting`)
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > limit) {
      throw new Error(`config: stats.compare.${key} must be an integer in 1..${limit}, got ${String(value)}`)
    }
    settings[key as keyof CompareSettings] = value
  }
  return { compare: settings }
}

export function loadConfig(file: string): BatonConfig {
  return parseConfig(JSON.parse(readFileSync(file, 'utf8')))
}
