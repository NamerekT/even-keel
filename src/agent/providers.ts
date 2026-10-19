import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'

/**
 * The providers a session may run on, by the agents' names in `src/agent/adapters.ts`: the keys of `provider`, `models`,
 * `accounts` and `execution` in the config and the first part of a task's run label. A page-safe list, without the adapters.
 */
export const PROVIDERS: readonly string[] = [CLAUDE, CODEX]
export const DEFAULT_PROVIDER = CLAUDE

export function isProvider(name: string): boolean {
  return PROVIDERS.includes(name)
}

/** The modes of `execution` by provider, the default first; a provider not listed has none. */
export const EXECUTION_MODES: Readonly<Record<string, readonly string[]>> = { [CODEX]: ['sandbox', 'bypass'] }

/**
 * Which CLI a provider's sessions run on (`cli`, BTN-250), the default first: `checked` — Even Keel's own copy of the
 * version it was last checked against, `system` — the one installed on the machine, on whatever version it updated to.
 */
export const CLI_SOURCES: readonly string[] = ['checked', 'system']

