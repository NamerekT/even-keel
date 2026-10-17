import { github } from '../github/adapter.js'
import { huly } from '../huly/adapter.js'
import { linear } from '../linear/adapter.js'
import type { KeyRules } from '../packages/keys.js'
import type { TrackerAdapter } from './source.js'

export const ADAPTERS: Readonly<Record<string, TrackerAdapter>> = { huly, github, linear }

export const DEFAULT_TRACKER = 'huly'

export const trackerVariables = (): string[] => Object.values(ADAPTERS).flatMap((adapter) => adapter.variables)

/** How the MCP gateway takes the trackers' keys from the pool: other names of a variable, and each tracker's own stdio server. */
export function trackerKeyRules(): KeyRules {
  return {
    aliases: Object.assign({}, ...Object.values(ADAPTERS).map((adapter) => adapter.mcpKeys ?? {})),
    trackers: Object.values(ADAPTERS).flatMap((adapter) =>
      adapter.mcpServer === undefined ? [] : [{ server: adapter.mcpServer, variables: adapter.variables, ready: (env: NodeJS.ProcessEnv) => ready(adapter, env) }],
    ),
  }
}

function ready(adapter: TrackerAdapter, env: NodeJS.ProcessEnv): boolean {
  try {
    return adapter.setup(env, {}) !== undefined
  } catch {
    return false
  }
}
