/** Where a setting of a session comes from: `chain` — what Even Keel passes with `--settings` and `--permission-mode`. */
export type ToolScope = 'user' | 'project' | 'local' | 'chain'

export type SettingKind = 'sync' | 'plugin' | 'skill' | 'permission' | 'mode'

export interface SettingRow {
  kind: SettingKind
  name: string
  values: Partial<Record<ToolScope, string>>
  /** What a session in a task worktree gets; `null` — only `settings.local.json` sets it, and a worktree does not read the main checkout's one. */
  session: string | null
}

export type McpScope = 'user' | 'local' | 'project' | 'plugin'

export interface McpRow {
  name: string
  scope: McpScope
  plugin: string | null
  disabled: boolean
  /** Local scope servers belong to the main checkout's path: a worktree session does not get them. */
  worktree: boolean
}

/** Top-level keys of an account folder's `settings.json` that differ from the global one. */
export interface AccountDrift {
  account: string
  keys: string[]
}

export type SkillSource = 'user' | 'project' | 'plugin' | 'claudeai' | 'bundled'

export interface ReceivedSkill {
  name: string
  source: SkillSource
}

export interface ReceivedMcp {
  name: string
  tools: number
  failed: boolean
}

/** What a session actually got, read from the first lines of its transcript. */
export interface ReceivedTools {
  sessionId: string | null
  cwd: string | null
  at: string | null
  version: string | null
  mode: string | null
  skills: string[]
  listingChars: number
  tools: string[]
  mcp: ReceivedMcp[]
}

export interface ReceivedView extends Omit<ReceivedTools, 'skills'> {
  skills: ReceivedSkill[]
  /** The e-mail of the account the session ran on, when known. */
  account?: string | null
}

export interface ToolsView {
  project: string
  repo: string
  trim: boolean
  settings: SettingRow[]
  mcp: McpRow[]
  accounts: AccountDrift[]
  received: ReceivedView | null
}
