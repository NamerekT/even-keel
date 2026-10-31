import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AccountHome } from '../account/homes.js'
import type { AccountStatus } from '../account/model.js'
import type { Language } from '../language.js'
import type { SessionLimits } from '../limits/model.js'
import type { UsageAnswer } from '../limits/usage.js'
import type { AgentEntry, SessionRecord as LiveRecord } from '../sessions/agents.js'
import type { TranscriptImage } from '../sessions/entry.js'
import type { DeliveredMail } from '../sessions/mail.js'
import type { CacheWindow, Feed, TranscriptSummary } from '../sessions/transcript.js'
import type { SessionRecord, TurnSpend } from '../state.js'

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
  /**
   * The CLI version Even Keel was last checked against live, as the README's "Before you run it" names it; the page warns
   * when another one is installed (BTN-249). Raised after the live run of each release (`docs/releases.md`).
   */
  checked: string
  /** The newest released version, from the source Even Keel's copy is downloaded from (BTN-569). */
  latest(): Promise<string>
  /** Sets the agent up;`env` gives the service's environment without the trackers' and CIs' credentials. */
  setup(options: AgentOptions): Agent
}

export interface AgentOptions {
  onCliFailure?: () => Promise<void> | void
  onCliProgress?: () => void
  /** Read at each call: `.env` changes on the fly. */
  env: () => NodeJS.ProcessEnv
  /** How long one call of the agent's CLI may take. */
  timeoutMs: number
  /** The service's state folder: a call that needs a working folder but belongs to no project runs there; `cli/<agent>` keeps the agent's own CLI copies. */
  workDir: string
  /** Read at each call: whether sessions run on Even Keel's own copy of `checked` (the `cli` setting) rather than the installed CLI. */
  checkedCli: () => boolean
  /** Optional. The version Even Keel's own copy is of, `checked` by default; the CLI check runs a candidate this way (`scripts/cli-check.ts`). */
  version?: string
  log: (line: string) => void
  /** The CLI the agent runs changed: its own copy finished downloading. */
  onCliChange: () => void
  /**
   * Optional. Read at each launch: how the account's new sessions run, for an agent that has more than one way (Claude:
   * `sdk` or `bg`, BTN-239); `null` — the agent's default for the account.
   */
  transport?: (home: AccountHome) => string | null
  /**
   * Optional. Read at each call: whether the chain runs unattended, for an agent that can ask the user to approve a
   * tool call (Claude through the SDK, BTN-303); without it nobody approves one.
   */
  unattended?: () => boolean
  /** Optional. Read at each call: the language the page speaks, for what an agent asks the user itself. */
  language?: () => Language
  /**
   * Optional. A session of the account reported its limits windows between the `/usage` polls (Claude through the
   * SDK, BTN-290).
   */
  onLimits?: (account: string, limits: SessionLimits) => void
}

/** What a session is started or resumed with. */
export interface SessionStart {
  /** The task id, or the name of a fix session; the session is found by it once started. */
  name: string
  cwd: string
  prompt: string
  /** The model as it goes to the agent's CLI (`runChoice`); `null` — the agent's configured default. */
  model: string | null
  /** Optional. Claude's `--settings` JSON for chain sessions (`src/tools/panel.ts`). */
  settings?: string
  /** Optional. Run without the agent's own sandbox and approvals (the global `execution` of the agent is `bypass`). */
  bypassSandbox?: boolean
  /** Native deny rules resolved from the current shared and project Protection settings. */
  protection?: import('../sessions/protection.js').Protection
  /** Optional. The project's main branch, for the Protection rules that forbid force-pushing or deleting it by a refspec. */
  mainBranch?: string
  /**
   * Optional. The MCP servers of the project's packages, all behind Even Keel's gateway (`src/packages/`): the session
   * gets these and no other. `undefined` — the agent's own configuration decides.
   */
  mcp?: SessionMcp[]
  /** Optional. The project's plugin packages, for an agent that reads Claude Code plugins. */
  plugins?: SessionPlugin[]
}

/** `Agent.models`' answer. */
export interface ModelList {
  models: string[]
  /** Whether the agent runs on nothing else; a list of aliases leaves full model ids out, so it is not. */
  complete: boolean
}

/** A turn of its own (`Agent.write`): it keeps no session, gets no MCP server or skill, and its tools only read. */
export interface OneTurn {
  cwd: string
  prompt: string
  /** As `SessionStart.model`. */
  model: string | null
  timeoutMs: number
}

/** The answer of `Agent.write` and what its turn cost. */
export interface OneTurnAnswer {
  text: string
  spend: TurnSpend
}

/** A server of the gateway: the session reaches it at `url` with no credentials of its own. */
export interface SessionMcp {
  name: string
  /** The plugin it comes with: Claude Code names its tools after the plugin, and the plugin's hooks match them so. */
  plugin: string | null
  url: string
}

/** A plugin package's install: its copy, and the marketplace of that copy alone for an agent that installs from one. */
export interface SessionPlugin {
  /** The package it comes from, as the page names it: `checkpoint@even-keel`. */
  package: string
  /** The plugin's folder. */
  dir: string
  /** The plugin's own name. */
  name: string
  /** The marketplace of this install alone, `ek-<install>`: the plugin is `<name>@<marketplace>` to an agent. */
  marketplace: string
  /** Its `.claude-plugin/marketplace.json`, the plugin's folder beside `.claude-plugin`. */
  marketplaceFile: string
  /** The plugin's own MCP servers: the session reaches them through the gateway, never as the plugin starts them. */
  servers: string[]
}

/**
 * The name a gateway server goes under: a plugin's keeps the one Claude Code gives a plugin's own, so its tools are
 * `mcp__plugin_<plugin>_<server>__*` in every agent, as the plugin's hooks and the permission rules name them.
 */
export function gatewayName(server: SessionMcp): string {
  return server.plugin === null ? server.name : `plugin_${server.plugin}_${server.name}`
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
  cli?: ReturnType<typeof import('./copy.js').cliCopy>
  updateMarketplace?(home: AccountHome, marketplace: string, timeoutMs: number): Promise<void>
  addMarketplace?(home: AccountHome, dir: string, timeoutMs: number): Promise<void>
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
  /**
   * Optional. Goes on in a live session with `start.prompt` without stopping it: the answer to its pending question, or
   * its next message. `null` — it cannot, and the caller stops the session and resumes it.
   */
  reply?(home: AccountHome, session: SessionHandle, start: SessionStart): Promise<string | null>
  /** Stops a session, mid-turn too, and waits until it is gone; a session already gone is left alone. */
  stop(home: AccountHome, session: SessionHandle): Promise<void>
  /** The account's sessions the agent knows, live and finished, each with `account` set to the folder's key. */
  sessions(home: AccountHome): Promise<AgentEntry[]>
  /** Follows a session's transcript in the account's folder. */
  tail(home: AccountHome, agent: AgentEntry): SessionTail
  /** A finished or live session's transcript in brief; `undefined` — the folder has no such session. */
  record(home: AccountHome, sessionId: string): Promise<SessionRecord | undefined>
  /**
   * Every line of the session's transcript from line `after` on, and its last turn; `undefined` — the folder has no such
   * session. `mail` — the chat's messages hooks delivered, for an agent whose transcript may not hold them (Copilot).
   */
  feed(home: AccountHome, sessionId: string, after: number, mail?: DeliveredMail[]): Promise<Feed | undefined>
  /** Optional. The file `feed` reads, watched while a chat window reads it; without it the window only polls. */
  feedFile?(home: AccountHome, sessionId: string): Promise<string | undefined>
  /** The ids of every session whose transcript the folder holds: those sessions ran on its account. */
  transcripts(home: AccountHome): Promise<string[]>

  authStatus(home: AccountHome): Promise<AccountStatus>
  /**
   * Starts the sign-in; the page shows its output and passes the code the user types to its stdin. `method` — which of
   * the agent's ways to sign in, for an agent that has several (OpenCode: `chatgpt`, `copilot`).
   */
  login(home: AccountHome, method?: string): ChildProcessWithoutNullStreams
  logout(home: AccountHome): Promise<void>
  /** Optional. Whether the agent's CLI is found; without it, it is taken as there. */
  installed?(): boolean
  /** Optional. What the CLI's `--version` prints; without it the installed version is not compared with `checked`. */
  version?(): Promise<string>
  /**
   * Optional. The CLI on the machine, whichever one sessions run on: `installed` and `version` above follow Even Keel's
   * copy once it is chosen and downloaded, this does not. The page's "Yours, X" is its version (BTN-622).
   */
  system?: { installed(): boolean; version(): Promise<string> }

  /** Optional. Picture `index` of the result of call `tool`, for the image lines of `feed`; without it the page shows none. */
  image?(home: AccountHome, sessionId: string, tool: string, index: number): Promise<TranscriptImage | undefined>
  /** Optional. The account's usage limits; without it the account shows none and the chain waits a limit out by the transcript. */
  usage?(home: AccountHome, at: string): Promise<UsageAnswer>
  /**
   * Optional. `usage` answers for an account signed in by a key too (Copilot's token reads its monthly allowance), and a
   * credit stop of such an account waits for its reset; without it a key account is not polled and shows its spend.
   */
  keyUsage?: boolean
  /**
   * Optional. The context window a session of the account gets on `model` with the chain's `settings`, asked of the
   * agent itself; `null` — it did not say. Without it the window is the transcript's, else the setting's (BTN-187).
   */
  contextWindow?(home: AccountHome, model: string, settings?: string): Promise<number | null>
  /**
   * Optional. The models a session of the account may run on, as `SessionStart.model` takes them: the page offers them
   * in the model fields, and a model outside a `complete` list is refused before a launch (BTN-336).
   */
  models?(home: AccountHome): Promise<ModelList>
  /** Optional, with `contextWindow`: what its answer depends on besides the model, such as the CLI and the account's settings. */
  windowStamp?(home: AccountHome): Promise<string>
  /** Optional. Stops the account's daemon so that its sessions read the shared configuration anew. */
  stopDaemon?(home: AccountHome): Promise<void>
  /** Optional. The version sessions run on while they run on Even Keel's own copy of `checked` (BTN-250); `null` — they don't. */
  pinned?(): string | null
  /**
   * Optional. The version of the account's daemon, `null` — none runs. A session runs on its daemon's version, not on
   * the client's that started it, so a daemon on another version than `pinned` is restarted once it is free.
   */
  daemonVersion?(home: AccountHome): Promise<string | null>
  /** Optional. The live sessions' own records, for the apps panel (which account an editor's chats run on). */
  liveRecords?(home: AccountHome): Promise<LiveRecord[]>
  /** Optional. Runs a turn of its own and returns the answer's text and cost; Even Keel writes changelog drafts with it (`src/changelog/`). */
  write?(home: AccountHome, turn: OneTurn): Promise<OneTurnAnswer>
  /**
   * Optional. The keep-warm ping (BTN-437): `start.prompt` goes to a fork of the session that writes no transcript and
   * changes nothing, run with the session's own options and `start.model`, and the answer is what its one call read
   * from the prompt cache and wrote. The session itself is not touched. Without it the agent's sessions are not kept warm.
   */
  warm?(home: AccountHome, session: SessionHandle, start: SessionStart): Promise<TurnSpend>
  /**
   * Optional. How long after a session's last reply the chain takes its prompt cache for warm and resumes it rather
   * than hands it over, by the cache its transcript last wrote and whether the account is signed in by a key
   * (`docs/sessions.md`, "Every agent's cache"). Without it `WARM_CACHE_MS`, an hour's cache.
   */
  warmMs?(cache: CacheWindow | null, apiKey: boolean): number
  /** Optional. Remote Control: whether the account starts sessions with it, and the bridge of a live session. */
  remote?: RemoteControl
}

export interface RemoteControl {
  enabled(home: AccountHome): Promise<boolean>
  bridge(home: AccountHome, agent: AgentEntry): Promise<string | null>
}
