import type { ServerEntry } from './model.js'

/** `${NAME}` or `${NAME:-default}`, as Claude Code reads `.mcp.json`. */
export const PLACEHOLDER = /\$\{(\w+)(?::-([^}]*))?\}/g

export function placeholders(entry: ServerEntry): string[] {
  return [...new Set([...JSON.stringify(entry).matchAll(PLACEHOLDER)].map((match) => match[1]!))]
}

/** Literal `env` values of stdio servers and headers of HTTP servers, without key placeholders. */
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
