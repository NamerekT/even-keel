import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import { COPILOT } from '../copilot/name.js'
import { OPENCODE } from '../opencode/name.js'

/**
 * The providers a session may run on, by the agents' names in `src/agent/adapters.ts`: the keys of `provider`, `models`,
 * `accounts` and `execution` in the config and the first part of a task's run label. A page-safe list, without the adapters.
 */
export const PROVIDERS: readonly string[] = [CLAUDE, CODEX, OPENCODE, COPILOT]
/** The providers Even Keel keeps a copy of the checked CLI for, the keys of `cli`: every one since BTN-347. */
export const PINNED_PROVIDERS: readonly string[] = [CLAUDE, CODEX, OPENCODE, COPILOT]
export const DEFAULT_PROVIDER = CLAUDE

export function isProvider(name: string): boolean {
  return PROVIDERS.includes(name)
}

/**
 * The ways to sign in by agent, for an agent with several (`Agent.login`'s `method`); an agent not listed has one.
 * `NO_SIGN_IN` makes a folder with no sign-in at all: OpenCode's own free models need none, and a Copilot folder without
 * a token runs on the CLI's own sign-in of the machine (a token is added as a key).
 */
export const SIGN_INS: Readonly<Record<string, readonly string[]>> = { [OPENCODE]: ['chatgpt', 'none'], [COPILOT]: ['none'] }
export const NO_SIGN_IN = 'none'

/**
 * The modes of `execution` by provider, the default first; a provider not listed has none. Claude Code's is how its
 * sessions run (BTN-353, `transportOf`): `auto` by the account's kind, or `claude --bg` or the Agent SDK for every one.
 */
export const EXECUTION_MODES: Readonly<Record<string, readonly string[]>> = { [CLAUDE]: ['auto', 'bg', 'sdk'], [CODEX]: ['sandbox', 'bypass'] }

/**
 * Which CLI a provider's sessions run on (`cli`, BTN-250), the default first: `checked` — Even Keel's own copy of the
 * version it was last checked against, `system` — the one installed on the machine, on whatever version it updated to.
 */
export const CLI_SOURCES: readonly string[] = ['checked', 'system']

