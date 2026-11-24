import { CODEX_ACCOUNT, GLOBAL_ACCOUNT } from '../account/model.js'
import { CLI_SOURCES, EXECUTION_MODES, PINNED_PROVIDERS } from '../agent/providers.js'
import { CI_KINDS, type CiKind } from '../ci/model.js'
import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import type { Language } from '../language.js'
import type { CacheTtl, CiSettings, ContextScale, SlotCleanup } from '../state.js'
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
export const DEFAULT_CLI: Readonly<Record<string, string>> = Object.fromEntries(PINNED_PROVIDERS.map((provider) => [provider, CLI_SOURCES[0]!]))
export const DEFAULT_LANGUAGE: Language = 'en'
/** The chain sessions' cache lifetime and keep-warm hours (BTN-1401): 5 minutes kept warm is cheaper than an hour. */
export const DEFAULT_CACHE_TTL: CacheTtl = '5m'
export const DEFAULT_KEEP_WARM = 2
/** Live project chat sessions a machine keeps (BTN-1653): a new one past them stops the longest idle. */
export const DEFAULT_CHAT_SESSIONS = 3
export const DEFAULT_CONTEXT: Readonly<ContextScale> = { warn: 50, danger: 80 }
export const DEFAULT_COMPARE: Readonly<CompareSettings> = { minTasks: 5, minSessions: 10, days: 7 }
export const DEFAULT_CI: Readonly<CiSettings> = Object.freeze({
  guard: true,
  kinds: Object.freeze([...CI_KINDS]) as CiKind[],
  waitMinutes: null,
  recheckMain: true,
  fixTask: false,
  rerunFailed: true,
})
/** What a slot loses after Done (BTN-1315), `.gitignore` patterns from its root; `keep` wins over `clean`. */
export const DEFAULT_SLOT_CLEANUP: Readonly<SlotCleanup> = Object.freeze({ clean: ['.temp/**'], keep: [] })
