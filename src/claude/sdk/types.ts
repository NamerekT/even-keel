import type { Readable, Writable } from 'node:stream'

/**
 * The part of `@anthropic-ai/claude-agent-sdk` (0.3.306) Even Keel uses. The package is not a dependency: its licence
 * is Anthropic's, so Even Keel downloads it next to the checked CLI (`release.ts`) and imports it from there, typed by
 * this file instead of its own `sdk.d.ts`.
 */
export interface SdkModule {
  query(params: { prompt: AsyncIterable<SdkUserMessage>; options: SdkOptions }): SdkQuery
}

export interface SdkUserMessage {
  type: 'user'
  message: { role: 'user'; content: string }
  parent_tool_use_id: null
}

export type SdkPermission =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

export type SdkCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID?: string },
) => Promise<SdkPermission>

export interface SdkSpawnOptions {
  command: string
  args: string[]
  cwd?: string
  env: Record<string, string | undefined>
  signal: AbortSignal
}

export interface SdkSpawnedProcess {
  stdin: Writable
  stdout: Readable
  readonly killed: boolean
  readonly exitCode: number | null
  kill(signal: NodeJS.Signals): boolean
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  once(event: 'error', listener: (error: Error) => void): void
  off(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  off(event: 'error', listener: (error: Error) => void): void
}

export interface SdkOptions {
  cwd: string
  env: Record<string, string | undefined>
  pathToClaudeCodeExecutable: string
  permissionMode: 'auto'
  model?: string
  title?: string
  sessionId?: string
  resume?: string
  /** Omitted, the SDK starts the CLI with an empty system prompt, not Claude Code's own. */
  systemPrompt?: { type: 'preset'; preset: 'claude_code' }
  /** The CLI's `--settings`: a file or a JSON text. */
  settings?: string
  mcpServers?: Record<string, { type: 'http'; url: string }>
  strictMcpConfig?: boolean
  plugins?: { type: 'local'; path: string }[]
  canUseTool: SdkCanUseTool
  spawnClaudeCodeProcess: (options: SdkSpawnOptions) => SdkSpawnedProcess
}

/** A message of the session's stream: only the fields Even Keel reads. */
export interface SdkMessage {
  type: string
  subtype?: string
  session_id?: string
  /** Of a `rate_limit_event` (`limitsOfRateLimitInfo`). */
  rate_limit_info?: unknown
}

export interface SdkInitialized {
  remote_control_available?: boolean
}

export interface SdkRemoteControl {
  session_url?: string
  bridge_session_id?: string
}

export interface SdkQuery extends AsyncIterable<SdkMessage> {
  initializationResult(): Promise<SdkInitialized>
  close(): void
  /** Not in `sdk.d.ts` (0.3.306), only in `sdk.mjs`: it may go without notice (`docs/sessions.md`). */
  enableRemoteControl?(
    enabled: boolean,
    name?: string,
    options?: { reattachSessionId?: string; keepSessionOnExit?: boolean },
  ): Promise<SdkRemoteControl>
}
