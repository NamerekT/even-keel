import { CODEX_ACCOUNT, GLOBAL_ACCOUNT } from '../account/model.js'
import { CLI_SOURCES, EXECUTION_MODES, PROVIDERS } from '../agent/providers.js'
import { CI_KINDS, type CiKind } from '../ci/model.js'
import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import type { Language } from '../language.js'
import type { CiSettings, ContextScale } from '../state.js'
import type { CompareSettings } from '../stats/rules.js'

export const CONFIG_FILE = 'even-keel.config.json'
export const DEFAULT_BRANCH = 'main'
/**
 * Claude's model unless the config names one: without `--model` the CLI takes it from `settings.json`, which an editor
 * may have just changed. Codex has none: its own config's model.
 */
export const DEFAULT_MODELS: Readonly<Record<string, string>> = { [CLAUDE]: 'opus' }
export const DEFAULT_ACCOUNTS: Readonly<Record<string, string>> = { [CLAUDE]: GLOBAL_ACCOUNT, [CODEX]: CODEX_ACCOUNT }
export const DEFAULT_EXECUTION: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EXECUTION_MODES).map(([provider, modes]) => [provider, modes[0]!]),
)
export const DEFAULT_CLI: Readonly<Record<string, string>> = Object.fromEntries(PROVIDERS.map((provider) => [provider, CLI_SOURCES[0]!]))
export const DEFAULT_LANGUAGE: Language = 'en'
export const DEFAULT_CONTEXT: Readonly<ContextScale> = { window: 600_000, warn: 50, danger: 80 }
export const DEFAULT_COMPARE: Readonly<CompareSettings> = { minTasks: 5, minSessions: 10, days: 7 }
export const DEFAULT_CI: Readonly<CiSettings> = Object.freeze({
  guard: true,
  kinds: Object.freeze([...CI_KINDS]) as CiKind[],
  waitMinutes: null,
  recheckMain: true,
  fixTask: false,
})
