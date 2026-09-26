import { readFileSync } from 'node:fs'

export interface BatonConfig {
  host: string
  port: number
  projects: Record<string, string>
}

const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,4}$/

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

  return { host, port, projects }
}

export function loadConfig(file: string): BatonConfig {
  return parseConfig(JSON.parse(readFileSync(file, 'utf8')))
}
