import { readFileSync } from 'node:fs'
import { isModelAlias, type ModelAlias } from './huly/model.js'
import type { ContextScale } from './state.js'

export interface BatonConfig {
  host: string
  port: number
  projects: Record<string, string>
  context: ContextScale
  modelPrompts: Partial<Record<ModelAlias, string>>
}

const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,4}$/
const DEFAULT_CONTEXT: ContextScale = { window: 600_000, warn: 50, danger: 80 }

export function parseConfig(raw: unknown): BatonConfig {
  const input = (raw ?? {}) as Partial<Record<keyof BatonConfig, unknown>>

  const host = input.host ?? '0.0.0.0'
  if (typeof host !== 'string' || host === '') throw new Error('config: host must be a non-empty string')

  const port = input.port ?? 4747
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`config: port must be an integer in 1..65535, got ${String(port)}`)
  }

  if (typeof input.projects !== 'object' || input.projects === null) {
    throw new Error('config: projects must map a Huly project key to a repository path')
  }
  const projects: Record<string, string> = {}
  for (const [key, path] of Object.entries(input.projects)) {
    if (!PROJECT_KEY.test(key)) throw new Error(`config: "${key}" is not a Huly project key`)
    if (typeof path !== 'string' || path === '') throw new Error(`config: repository path for ${key} is empty`)
    projects[key] = path
  }

  return { host, port, projects, context: parseContext(input.context), modelPrompts: parseModelPrompts(input.modelPrompts) }
}

function parseModelPrompts(raw: unknown): Partial<Record<ModelAlias, string>> {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null) throw new Error('config: modelPrompts must map a model alias to a prompt')
  const prompts: Partial<Record<ModelAlias, string>> = {}
  for (const [model, text] of Object.entries(raw)) {
    if (!isModelAlias(model)) throw new Error(`config: modelPrompts.${model} is not a model alias`)
    if (typeof text !== 'string' || text.trim() === '') throw new Error(`config: modelPrompts.${model} is empty`)
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

export function loadConfig(file: string): BatonConfig {
  return parseConfig(JSON.parse(readFileSync(file, 'utf8')))
}
