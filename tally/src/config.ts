import { DEFAULT_SIGN_RULES, type SignRules } from './signs.js'
import { DEFAULT_STEPS, type StepSettings } from './step-runs.js'

export interface Rates {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

// longPrompt — the rates of a request whose prompt (input, cache read and cache writes) is over `over` tokens;
// they apply to all of its tokens (Haiku 5.5 over 100k).
export interface Price extends Rates {
  model: string
  longPrompt: (Rates & { over: number }) | null
}

export interface ClassifySettings {
  perRun: number
  idleMinutes: number
  sinceDays: number
}

export interface TallyConfig {
  evenKeelUrl: string
  prices: Price[]
  signs: SignRules
  classify: ClassifySettings
  ruleHistory: string | null
  reportsSince: string | null
  // Exact model names with no public price: their cost stays empty and the run does not log them.
  unpriced: string[]
  steps: StepSettings
}

export interface DbSettings {
  host: string
  port: number
  database: string
  user: string
  password: string
}

const PRICE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'] as const
const DEFAULT_EVEN_KEEL_URL = 'http://127.0.0.1:4747'
export const DEFAULT_CLASSIFY: ClassifySettings = { perRun: 10, idleMinutes: 60, sinceDays: 14 }

export function parseConfig(raw: unknown): TallyConfig {
  const record = (raw ?? {}) as {
    evenKeelUrl?: unknown
    prices?: unknown
    signs?: unknown
    classify?: unknown
    ruleHistory?: unknown
    reportsSince?: unknown
    unpriced?: unknown
    steps?: unknown
  }
  const since = record.reportsSince
  if (since !== undefined && since !== null && (typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(since)))) {
    throw new Error('tally: "reportsSince" must be a date YYYY-MM-DD or null')
  }
  if (record.ruleHistory !== undefined && (typeof record.ruleHistory !== 'string' || record.ruleHistory === '')) {
    throw new Error('tally: "ruleHistory" must be a path to the rule history import')
  }
  const prices = record.prices
  if (typeof prices !== 'object' || prices === null || Object.keys(prices).length === 0) {
    throw new Error('tally: config needs "prices" per model prefix')
  }
  const unpriced = record.unpriced ?? []
  if (!Array.isArray(unpriced) || unpriced.some((model) => typeof model !== 'string' || model === '')) {
    throw new Error('tally: "unpriced" must be a list of model names')
  }
  for (const model of unpriced as string[]) {
    const covering = Object.keys(prices).find((prefix) => model.startsWith(prefix))
    if (covering !== undefined) throw new Error(`tally: unpriced ${model} has a price by prices.${covering}`)
  }
  return {
    evenKeelUrl: typeof record.evenKeelUrl === 'string' && record.evenKeelUrl !== '' ? record.evenKeelUrl : DEFAULT_EVEN_KEEL_URL,
    prices: Object.entries(prices as Record<string, Record<string, unknown>>).map(([model, value]) => ({
      model,
      ...rates(`prices.${model}`, value),
      longPrompt: value?.longPrompt === undefined ? null : longPrompt(`prices.${model}.longPrompt`, value.longPrompt),
    })),
    signs: integers('signs', record.signs, DEFAULT_SIGN_RULES, 1),
    classify: integers('classify', record.classify, DEFAULT_CLASSIFY, 0),
    ruleHistory: (record.ruleHistory as string | undefined) ?? null,
    reportsSince: (since as string | null | undefined) ?? null,
    unpriced: unpriced as string[],
    steps: parseSteps(record.steps),
  }
}

export function unpricedToLog(models: string[], known: string[]): string[] {
  return models.filter((model) => !known.includes(model))
}

function rates(name: string, raw: Record<string, unknown> | undefined): Rates {
  const result = {} as Rates
  for (const key of PRICE_KEYS) {
    const amount = raw?.[key]
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new Error(`tally: ${name}.${key} must be a non-negative number (USD per million tokens)`)
    }
    result[key] = amount
  }
  return result
}

function longPrompt(name: string, raw: unknown): Rates & { over: number } {
  const record = objectOf(name, raw)
  if (!Number.isInteger(record.over) || (record.over as number) < 1) {
    throw new Error(`tally: ${name}.over must be a positive integer (prompt tokens)`)
  }
  return { over: record.over as number, ...rates(name, record) }
}

function parseSteps(raw: unknown): StepSettings {
  if (raw === undefined) return structuredClone(DEFAULT_STEPS)
  const record = objectOf('steps', raw)
  for (const key of Object.keys(record)) {
    if (!(key in DEFAULT_STEPS)) throw new Error(`tally: steps.${key} is not a known setting`)
  }
  const projects: Record<string, Record<string, string>> = structuredClone(DEFAULT_STEPS.projects)
  for (const [project, rules] of Object.entries(record.projects === undefined ? {} : objectOf('steps.projects', record.projects))) {
    projects[project] = stepRules(`steps.projects.${project}`, rules, projects[project] ?? {})
  }
  const slow = record.slowSeconds ?? DEFAULT_STEPS.slowSeconds
  if (typeof slow !== 'number' || !(slow > 0)) throw new Error('tally: steps.slowSeconds must be a positive number of seconds')
  const growth = { ...DEFAULT_STEPS.growth, ...(record.growth === undefined ? {} : objectOf('steps.growth', record.growth)) }
  for (const key of Object.keys(growth)) {
    if (!(key in DEFAULT_STEPS.growth)) throw new Error(`tally: steps.growth.${key} is not a known setting`)
  }
  if (typeof growth.ratio !== 'number' || !(growth.ratio > 1)) throw new Error('tally: steps.growth.ratio must be a number above 1')
  if (!Number.isInteger(growth.minRuns) || growth.minRuns < 1) throw new Error('tally: steps.growth.minRuns must be an integer ≥ 1')
  if (typeof growth.minSeconds !== 'number' || growth.minSeconds < 0) throw new Error('tally: steps.growth.minSeconds must be ≥ 0')
  return {
    rules: stepRules('steps.rules', record.rules ?? {}, DEFAULT_STEPS.rules),
    projects,
    slowSeconds: slow,
    growth: growth as StepSettings['growth'],
  }
}

function stepRules(name: string, raw: unknown, defaults: Record<string, string>): Record<string, string> {
  const rules = { ...defaults }
  for (const [step, source] of Object.entries(objectOf(name, raw))) {
    if (source === null) {
      delete rules[step]
      continue
    }
    if (typeof source !== 'string' || source === '') throw new Error(`tally: ${name}.${step} must be a regular expression or null`)
    try {
      new RegExp(source, 'i')
    } catch (error) {
      throw new Error(`tally: ${name}.${step}: ${(error as Error).message}`)
    }
    rules[step] = source
  }
  return rules
}

function objectOf(name: string, raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`tally: "${name}" must be an object`)
  return raw as Record<string, unknown>
}

function integers<T extends object>(name: string, raw: unknown, defaults: T, min: number): T {
  if (raw === undefined) return { ...defaults }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`tally: "${name}" must be an object`)
  const result = { ...defaults } as Record<string, number>
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in defaults)) throw new Error(`tally: ${name}.${key} is not a known setting`)
    if (!Number.isInteger(value) || (value as number) < min) throw new Error(`tally: ${name}.${key} must be an integer ≥ ${min}`)
    result[key] = value as number
  }
  return result as T
}

// null — no server: the local PGlite database in the Even Keel state folder.
export function dbSettings(env: NodeJS.ProcessEnv): DbSettings | null {
  if (!env.TALLY_DB_HOST) return null
  const missing = ['TALLY_DB_HOST', 'TALLY_DB_NAME', 'TALLY_WRITER_PASSWORD'].filter((name) => !env[name])
  if (missing.length > 0) throw new Error(`tally: set ${missing.join(', ')} in .env`)
  return {
    host: env.TALLY_DB_HOST!,
    port: Number(env.TALLY_DB_PORT || 5432),
    database: env.TALLY_DB_NAME!,
    user: env.TALLY_WRITER_USER || 'tally_writer',
    password: env.TALLY_WRITER_PASSWORD!,
  }
}
