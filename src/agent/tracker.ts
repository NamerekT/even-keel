import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TrackerServer } from './contract.js'

/**
 * The tracker's MCP server for an agent that does not read Claude Code plugins: the entry `name` of the plugin's
 * `.mcp.json`, with the values of the adapter's variables and of those the entry names as `${…}`, from the first of
 * `sources` that has each — the `env` of the user's `~/.claude/settings.json` first, where Claude sessions take them.
 */
export function trackerServerOf(
  name: string,
  mcpFile: unknown,
  variables: readonly string[],
  sources: readonly Record<string, string | undefined>[],
): TrackerServer | undefined {
  const server = (mcpFile as { mcpServers?: Record<string, unknown> } | undefined)?.mcpServers?.[name]
  if (typeof server !== 'object' || server === null) return undefined
  const placeholders = [...JSON.stringify(server).matchAll(/\$\{(\w+)\}/g)].map((match) => match[1]!)
  const env: Record<string, string> = {}
  for (const variable of new Set([...variables, ...placeholders])) {
    const value = sources.map((source) => source[variable]).find((each) => each !== undefined && each !== '')
    if (value !== undefined) env[variable] = value
  }
  return { name, server, env }
}

/** `trackerServerOf` with the plugin of Even Keel at `root` and the `env` of the user's settings in `claudeDir`. */
export function readTrackerServer(
  root: string,
  name: string,
  variables: readonly string[],
  claudeDir: string,
  env: NodeJS.ProcessEnv,
): TrackerServer | undefined {
  const settings = readJson(join(claudeDir, 'settings.json')) as { env?: Record<string, string> } | undefined
  return trackerServerOf(name, readJson(join(root, 'plugins', name, '.mcp.json')), variables, [settings?.env ?? {}, env])
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}
