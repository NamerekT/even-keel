import { DEFAULT_SIGN_RULES, type SignRules } from './signs.js'

export interface Price {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

export interface ClassifySettings {
  perRun: number
  idleMinutes: number
  sinceDays: number
}

export interface TallyConfig {
  batonUrl: string
  prices: Price[]
  signs: SignRules
  classify: ClassifySettings
}

export interface DbSettings {
  host: string
  port: number
  database: string
  user: string
  password: string
}

const PRICE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'] as const
const DEFAULT_BATON_URL = 'http://127.0.0.1:4747'
export const DEFAULT_CLASSIFY: ClassifySettings = { perRun: 10, idleMinutes: 60, sinceDays: 14 }

export function parseConfig(raw: unknown): TallyConfig {
  const record = (raw ?? {}) as { batonUrl?: unknown; prices?: unknown; signs?: unknown; classify?: unknown }
  const prices = record.prices
  if (typeof prices !== 'object' || prices === null || Object.keys(prices).length === 0) {
    throw new Error('tally: config needs "prices" per model prefix')
  }
  return {
    batonUrl: typeof record.batonUrl === 'string' && record.batonUrl !== '' ? record.batonUrl : DEFAULT_BATON_URL,
    prices: Object.entries(prices as Record<string, Record<string, unknown>>).map(([model, value]) => {
      const price = { model } as Price
      for (const key of PRICE_KEYS) {
        const amount = value?.[key]
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
          throw new Error(`tally: prices.${model}.${key} must be a non-negative number (USD per million tokens)`)
        }
        price[key] = amount
      }
      return price
    }),
    signs: integers('signs', record.signs, DEFAULT_SIGN_RULES, 1),
    classify: integers('classify', record.classify, DEFAULT_CLASSIFY, 0),
  }
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

export function dbSettings(env: NodeJS.ProcessEnv): DbSettings {
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
