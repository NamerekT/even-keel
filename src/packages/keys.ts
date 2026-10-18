import { fail } from '../notice/notice.js'
import type { ServerEntry } from './model.js'

/** `${NAME}` or `${NAME:-default}`, as Claude Code reads `.mcp.json`. */
const PLACEHOLDER = /\$\{(\w+)(?::-([^}]*))?\}/g
const PLAIN_VALUE = /^[\w.\-/:+=@~%,]*$/
const NAME = /^[A-Za-z_]\w*$/

/** The tracker's own stdio server: it gets the adapter's variables, and the adapter tells whether they are enough. */
export interface TrackerKeys {
  server: string
  variables: readonly string[]
  /** The adapter would start with these values. */
  ready: (env: NodeJS.ProcessEnv) => boolean
}

export interface KeyRules {
  /** A placeholder's name in the pool when it differs (`GITHUB_PERSONAL_ACCESS_TOKEN` ← `GITHUB_TOKEN`), from the tracker adapters. */
  aliases: Readonly<Record<string, string>>
  trackers: readonly TrackerKeys[]
}

export interface ServerKeys {
  /** The value of each placeholder of the entry. */
  values: Record<string, string>
  /** Variables a stdio tracker server gets in its environment. */
  env: Record<string, string>
  /** Pool variables that are not set and the server needs. */
  missing: string[]
  /** Every pool variable the server reads: the page shows whether each is set. */
  names: string[]
}

export function placeholders(entry: ServerEntry): string[] {
  return [...new Set([...JSON.stringify(entry).matchAll(PLACEHOLDER)].map((match) => match[1]!))]
}

/** Placeholders every occurrence of which has a default: the server starts without them. */
function defaulted(entry: ServerEntry): Set<string> {
  const matches = [...JSON.stringify(entry).matchAll(PLACEHOLDER)]
  const bare = new Set(matches.filter((match) => match[2] === undefined).map((match) => match[1]!))
  return new Set(matches.map((match) => match[1]!).filter((name) => !bare.has(name)))
}

/** What the server `name` needs from the pool and what of it is set; values never leave the service. */
export function keysOf(name: string, entry: ServerEntry, rules: KeyRules, env: NodeJS.ProcessEnv): ServerKeys {
  const values: Record<string, string> = {}
  const missing: string[] = []
  const names: string[] = []
  const optional = defaulted(entry)
  for (const placeholder of placeholders(entry)) {
    const pool = rules.aliases[placeholder] ?? placeholder
    names.push(pool)
    const value = env[pool] || env[placeholder]
    if (value) values[placeholder] = value
    else if (!optional.has(placeholder)) missing.push(placeholder === pool ? pool : placeholder)
  }
  const tracker = typeof entry.command === 'string' ? rules.trackers.find((each) => each.server === name) : undefined
  const own: Record<string, string> = {}
  if (tracker !== undefined) {
    for (const variable of tracker.variables) {
      names.push(variable)
      if (env[variable]) own[variable] = env[variable]
    }
    if (!tracker.ready(env)) missing.push(...tracker.variables.filter((variable) => !env[variable]))
  }
  return { values, env: own, missing: [...new Set(missing)], names: [...new Set(names)] }
}

export function substitute(entry: ServerEntry, values: Record<string, string>): ServerEntry {
  return JSON.parse(JSON.stringify(entry), (_key, value: unknown) =>
    typeof value === 'string' ? value.replace(PLACEHOLDER, (whole, name: string, fallback?: string) => values[name] ?? fallback ?? whole) : value,
  ) as ServerEntry
}

/** A package's settings: the `env` of its stdio servers and the headers of its HTTP ones, those without a key in them. */
export function defaultSettings(servers: Record<string, ServerEntry>): Record<string, string> {
  const settings: Record<string, string> = {}
  for (const entry of Object.values(servers)) {
    for (const [key, value] of Object.entries(settable(entry))) if (typeof value === 'string' && placeholders({ value }).length === 0) settings[key] = value
  }
  return settings
}

export function applySettings(entry: ServerEntry, settings: Record<string, string>): ServerEntry {
  const field = typeof entry.command === 'string' ? 'env' : 'headers'
  const own = settable(entry)
  const applied = Object.fromEntries(Object.entries(own).map(([key, value]) => [key, key in settings && placeholders({ value }).length === 0 ? settings[key] : value]))
  return Object.keys(own).length === 0 ? entry : { ...entry, [field]: applied }
}

function settable(entry: ServerEntry): Record<string, unknown> {
  const own = typeof entry.command === 'string' ? entry.env : entry.headers
  return typeof own === 'object' && own !== null && !Array.isArray(own) ? (own as Record<string, unknown>) : {}
}

/** `.env` with the variable's line replaced, or added at the end; every other line stays as it is. */
export function upsertEnv(text: string, name: string, value: string): string {
  const line = envLine(name, value)
  const lines = envLines(text)
  const at = lines.findIndex(assigns(name))
  if (at >= 0) lines[at] = line
  else lines.push(line)
  return `${lines.join('\n')}\n`
}

/** `.env` without the variable's lines; every other line, comments included, stays as it is. */
export function removeEnv(text: string, name: string): string {
  const lines = envLines(text).filter((line) => !assigns(name)(line))
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

const envLines = (text: string): string[] => (text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/))
const assigns = (name: string) => (line: string) => new RegExp(`^\\s*(export\\s+)?${name}\\s*=`).test(line)

/** `NAME=value`, the value in single quotes when `process.loadEnvFile` would cut it otherwise. */
export function envLine(name: string, value: string): string {
  if (!NAME.test(name)) throw fail('packages.keyName', { name })
  if (/[\r\n']/.test(value)) throw fail('packages.keyValue', { name })
  return PLAIN_VALUE.test(value) ? `${name}=${value}` : `${name}='${value}'`
}
