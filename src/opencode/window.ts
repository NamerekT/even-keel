import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CLAUDE_COMPACTION_GAP } from '../stats/checkpoint.js'

/** A model's limits in OpenCode's catalogue: the window and the most it writes in one step. */
export interface ModelLimit {
  context: number
  output: number
}

/** The window Even Keel sets for a chain session's model (`openCodeAutoCompactWindow`, BTN-856). */
export interface SessionWindow {
  model: string
  window: number
  output: number
}

/** Where OpenCode keeps its copy of the models.dev catalogue in an account's folder. */
export function catalogueFile(dir: string): string {
  return join(dir, 'cache', 'opencode', 'models.json')
}

/** OpenCode's copy of the models.dev catalogue in the account's folders; empty when there is none yet. */
export function readCatalogue(dir: string): Promise<string> {
  return readFile(catalogueFile(dir), 'utf8').catch(() => '')
}

/**
 * The limits of `<provider>/<model>` in the catalogue (`{ <provider>: { models: { <model>: { limit } } } }`); `null`
 * when it has no such model or no `context` and `output`, both of which a config's `limit` must give.
 */
export function limitOf(catalogue: string, model: string): ModelLimit | null {
  const slash = model.indexOf('/')
  if (slash <= 0) return null
  try {
    const limit: unknown = JSON.parse(catalogue)?.[model.slice(0, slash)]?.models?.[model.slice(slash + 1)]?.limit
    const { context, output } = (limit ?? {}) as Record<string, unknown>
    return positive(context) && positive(output) ? { context, output } : null
  } catch {
    return null
  }
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * The window a session of `model` gets from the setting: only below the model's own, so a 250k setting on a 200k
 * model sets nothing. No setting, no model chosen (`-m`) or a model the catalogue does not know — the model's own.
 */
export function sessionWindow(catalogue: string, model: string | null, setting: number | undefined): SessionWindow | undefined {
  if (setting === undefined || model === null) return undefined
  const limit = limitOf(catalogue, model)
  return limit === null || setting >= limit.context ? undefined : { model, window: setting, output: limit.output }
}

/**
 * The part of `OPENCODE_CONFIG_CONTENT` that sets the window. OpenCode 1.19.5 compacts at `limit.input` less
 * `compaction.reserved` when the model has an input limit, so both are set: the session compacts at the window less
 * 32k, where Claude's does (`compactionLimit`).
 */
export function windowConfig({ model, window, output }: SessionWindow): Record<string, unknown> {
  const slash = model.indexOf('/')
  const limit = { context: window, input: window, output }
  return {
    provider: { [model.slice(0, slash)]: { models: { [model.slice(slash + 1)]: { limit } } } },
    compaction: { reserved: CLAUDE_COMPACTION_GAP },
  }
}
