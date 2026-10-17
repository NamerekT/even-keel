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

