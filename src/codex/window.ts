import type { EvenKeelConfig } from '../config.js'
import { CLAUDE_COMPACTION_GAP } from '../stats/checkpoint.js'

/** The token count a session with this window compacts at: where Claude's does with the same window (BTN-810). */
export function compactionLimit(window: number): number {
  return window - CLAUDE_COMPACTION_GAP
}

/** A chain session's window and its compaction point as `codex exec` flags; none — the model's own. */
export function windowArgs(window: number | undefined): string[] {
  return window === undefined ? [] : ['-c', `model_context_window=${window}`, '-c', `model_auto_compact_token_limit=${compactionLimit(window)}`]
}

/** The settings of a chain session's window, one per agent that takes it through `SessionStart.contextWindow`. */
export type WindowKey = 'codexAutoCompactWindow' | 'openCodeAutoCompactWindow'

/** The window a new chain session of the project starts with: the project's, else Even Keel's; none — the model's. */
export function chainWindowOf(config: Pick<EvenKeelConfig, 'settings' | WindowKey>, project: string | undefined, key: WindowKey = 'codexAutoCompactWindow'): number | undefined {
  const settings = project === undefined ? undefined : config.settings[project]
  return (settings === undefined ? config[key] : settings[key]) ?? undefined
}
