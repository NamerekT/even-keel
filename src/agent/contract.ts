import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AccountHome } from '../account/homes.js'
import type { AccountStatus } from '../account/model.js'
import type { UsageAnswer } from '../limits/usage.js'
import type { AgentEntry, SessionRecord as LiveRecord } from '../sessions/agents.js'
import type { FeedLine, TranscriptSummary } from '../sessions/transcript.js'
import type { SessionRecord } from '../state.js'
import type { ModelAlias } from '../tracker/model.js'

/**
 * The contract of an agent adapter. Even Keel runs chain sessions, reads their transcripts and signs accounts in
 * through it and never calls an agent's CLI directly; Claude Code (`src/claude/adapter.ts`) is one implementation.
 * An adapter is registered in `src/agent/adapters.ts` under its name; every account folder (`AccountHome.agent`)
 * belongs to one agent, and a session runs on the agent of its account.
 *
 * Nothing here requires a session to be a live process between turns: a session is its id and its transcript,
 * a turn may be a process of its own that `resume` starts again.
 */
export interface AgentAdapter {
  /** For the log and the page. */
  title: string
  /** Sets the agent up; `env` is the service's environment without the trackers' and CIs' credentials. */
  setup(options: AgentOptions): Agent
}

export interface AgentOptions {
  env: NodeJS.ProcessEnv
  /** How long one call of the agent's CLI may take. */
  timeoutMs: number
  /** The service's state folder: a call that needs a working folder but belongs to no project runs there. */
  workDir: string
}

/** What a session is started or resumed with. */
export interface SessionStart {
  /** The task id, or the name of a fix session; the session is found by it once started. */
  name: string
  cwd: string
  prompt: string
  /** From the task's model label; an agent without such models ignores it. */
  model: ModelAlias
  /** Optional. Claude's `--settings` JSON for chain sessions (`src/tools/panel.ts`). */
  settings?: string
}

/** A session as the agent knows it: the id of its job or process and the id of its conversation. */
export interface SessionHandle {
  agentId: string
  sessionId: string
}

/** A session's transcript read as it grows. */
export interface SessionTail {
  /** The transcript file, once found. */
  readonly path: string | undefined
  /** The session's entry changed (a resume may move it). */
  follow(agent: AgentEntry): void
  /** Reads what was appended since the last read. */
  read(): Promise<void>
  /** Stage, current action, context fill, the question it waits on, the API error and the rest the page and the chain read. */
  summary(): TranscriptSummary
}

export interface Agent {
  /** The permission mode chain sessions run in, as the tools panel shows it. */
  readonly mode: string
  /** The environment the agent's commands run in for an account: the base plus what points the agent at the folder. */
  env(home: AccountHome): NodeJS.ProcessEnv

  /** Starts a session and returns its id once the agent shows it. */
  launch(home: AccountHome, start: SessionStart): Promise<string>
  /**
   * Goes on in a session with a new prompt and returns the id it came up under (it may be new). The chain resumes after
   * a limit, delivers the user's answer and goes on after a checkpoint this way; a handoff is a `launch` in the same place.
   */
  resume(home: AccountHome, session: SessionHandle, start: SessionStart): Promise<string>
  /** Stops a session, mid-turn too, and waits until it is gone; a session already gone is left alone. */
  stop(home: AccountHome, session: SessionHandle): Promise<void>
  /** The account's sessions the agent knows, live and finished, each with `account` set to the folder's key. */
  sessions(home: AccountHome): Promise<AgentEntry[]>
  /** Follows a session's transcript in the account's folder. */
  tail(home: AccountHome, agent: AgentEntry): SessionTail
  /** A finished or live session's transcript in brief; `undefined` — the folder has no such session. */
  record(home: AccountHome, sessionId: string): Promise<SessionRecord | undefined>
  /** Every line of the session's transcript from line `after` on; `undefined` — the folder has no such session. */
  feed(home: AccountHome, sessionId: string, after: number): Promise<FeedLine[] | undefined>
  /** The ids of every session whose transcript the folder holds: those sessions ran on its account. */
  transcripts(home: AccountHome): Promise<string[]>

  authStatus(home: AccountHome): Promise<AccountStatus>
  /** Starts the sign-in; the page shows its output and passes the code the user types to its stdin. */
  login(home: AccountHome): ChildProcessWithoutNullStreams
  logout(home: AccountHome): Promise<void>

  /** Optional. The account's usage limits; without it the account shows none and the chain waits a limit out by the transcript. */
  usage?(home: AccountHome, at: string): Promise<UsageAnswer>
  /** Optional. Stops the account's daemon so that its sessions read the shared configuration anew. */
  stopDaemon?(home: AccountHome): Promise<void>
  /** Optional. The live sessions' own records, for the apps panel (which account an editor's chats run on). */
  liveRecords?(home: AccountHome): Promise<LiveRecord[]>
  /** Optional. Remote Control: whether the account starts sessions with it, and the bridge of a live session. */
  remote?: RemoteControl
}

export interface RemoteControl {
  enabled(home: AccountHome): Promise<boolean>
  bridge(home: AccountHome, agent: AgentEntry): Promise<string | null>
}
