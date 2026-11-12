import type { StatusMoves } from '../chain/moves.js'
import type { ChainRules } from '../chain/rules.js'
import type { CiKind, RemoteProfiles } from '../ci/model.js'
import type { Language } from '../language.js'
import type { Protection } from '../sessions/protection.js'
import type { PassableStep } from '../setup.js'
import type { CompareSettings } from '../stats/rules.js'
import type { UpdateSettings } from '../updates/release.js'

/**
 * A project's standard (BTN-359): a document of its repository and the files it guards. A session gets the document
 * at its first read of such a file and cannot edit one before; with `shots`, the merge of a branch that changed them
 * waits for shots and the answers to the document's "The check" (`plugins/agent-bridge/hooks/standards.mjs`).
 */
export interface Standard {
  /** The document, relative to the repository's root. */
  doc: string
  /** Glob masks relative to the repository's root: `**` any folders, `*` any name part. */
  files: string[]
  /** Masks of files left out of `files`. */
  except: string[]
  shots: boolean
}

/**
 * What the user sets per project and the chain reads live: `branch`, `prompt`, `commands.beforeStart`, `commands.check`,
 * `commands.afterGreen`, `ci`, `remoteProfiles`, `pullRequests`, `git`, `intakeLabel`, `mergeInto`, `fillMilestone`, `changelog`, `standards`, `provider`, `models`, `accounts` and `modelLabels` in the config.
 */
export interface ProjectSettings {
  /** Hidden from aggregate charts by default; collection and chain behaviour are unchanged. */
  testProject: boolean
  /** The project's main branch: tasks branch off it and merge into it, the CI watches it. */
  branch: string
  /** Added to the prompt of every new session of the project, after Even Keel's own; `null` — none. Only the project's own: the levels add up. */
  prompt: string | null
  /** Run in order in the task's folder before a new session starts. */
  beforeStart: string[]
  /** The project's check, run in order when no counted CI judges main: before a session merges, and on main if it moved. */
  check: string[]
  /** Run in order in the project's checkout once a push of main is green, if the checkout is on main at that commit. */
  afterGreen: string[]
  ci: CiSettings
  /** The profile the CI and the pull requests of the project's remotes of each kind take (BTN-231); none — the default. */
  remoteProfiles: RemoteProfiles
  /** PR mode (BTN-205): a session does not merge its branch, Even Keel pushes it and opens a pull request. */
  pullRequests: boolean
  /**
   * `false` — a project without git (BTN-883): its folder is no repository, so no worktree, slot, branch, merge or CI;
   * one session at a time works in the folder and a task closes by the `TASK DONE` mark. Chosen when the project is
   * added; the config then reads `pullRequests`, `mergeInto` and `ci.guard` as off and gives it no slots.
   */
  git: boolean
  /** The label of the project's GitHub remote whose issues become tasks of its tracker (BTN-262); `null` — none are taken in. */
  intakeLabel: string | null
  /** A release project (BTN-172): the project whose branch its own one merges into once that project's chain is quiet; `null` — a main project. */
  mergeInto: string | null
  /** A release project's carry that conflicts goes to the agent's session by itself, not only by "Resolve with the agent" (BTN-370). */
  carryAgent: boolean
  /** A task that enters the chain without a milestone gets the active one in the tracker. */
  fillMilestone: boolean
  /** The project's own milestone order by label (BTN-792), read only: `project/milestone-order` writes it; empty — automatic. */
  milestoneOrder?: string[]
  /** The README badge (BTN-915): the project's form leaves it alone, the badge dialog writes it (`project/badge`); `null` — none. */
  badge?: import('../badge/model.js').BadgeSettings | null
  /** The changelog file, relative to the repository's root (BTN-209). */
  changelog: string
  /** The documents of the repository that guard some of its files, handed to the sessions by the `checkpoint` hooks (BTN-359). */
  standards: Standard[]
  /** The provider the project's sessions run on (`claude`, `codex`); `null` — the shared one. A task's run label may override it. */
  provider: string | null
  /** The project's own model by provider, over the shared `models`. */
  models: Record<string, string>
  /** The project's own account folder by provider, over the shared `accounts`. */
  accounts: Record<string, string>
  /** Whether the tasks' run labels are read; `null` — as the shared `modelLabels` says. */
  modelLabels: boolean | null
  /** The language of the project's prompts and of what Even Keel writes into its tracker, the shared one filled in. */
  promptLanguage: Language
  /** The prompt cache TTL of the project's sessions, the shared one filled in; `null` — the CLI's own choice. */
  cacheTtl: CacheTtl | null
  /** Claude chain sessions' compaction window in tokens; null inherits the account's window. */
  autoCompactWindow: number | null
  /** Codex chain sessions' context window in tokens (BTN-810); null keeps the model's own window. */
  codexAutoCompactWindow: number | null
  /** OpenCode chain sessions' context window in tokens (BTN-856), capped by the model's own; null keeps the model's. */
  openCodeAutoCompactWindow: number | null
  /** The resolved native deny rules; omitted by older clients. */
  protection?: Protection
  /** The agent-bridge hook asks for handoffs by context size (BTN-255), the shared one filled in; `false` — the agent's own compaction keeps the context. */
  contextHandoffs: boolean
  /** The agent-bridge hook's first threshold for the project, the shared one filled in; `null` — calibrated. */
  checkpointTokens: number | null
  /** The shares of the session's window the checkpoint thresholds come at, at most; each the shared one unless the project has its own. */
  checkpointShares: CheckpointShares
  /** The project's own `notices` entries (BTN-759) over Even Keel's, read only: `notices/mute` writes them; none — as shared. */
  notices?: Record<string, boolean>
  /** The project's own rows of the keys Even Keel sets too (`ci.*` and the five above); a key left out — as shared. */
  own: OwnValues
}

/** The keys a project may set for itself or leave to Even Keel's value, which the settings panel shows as "as shared". */
export type OwnKey = keyof OwnValues

export interface OwnValues {
  protection?: Partial<Protection>
  'ci.guard'?: boolean
  'ci.kinds'?: CiKind[]
  'ci.waitMinutes'?: number | null
  'ci.recheckMain'?: boolean
  'ci.fixTask'?: boolean
  'ci.rerunFailed'?: boolean
  fillMilestone?: boolean
  promptLanguage?: Language
  cacheTtl?: CacheTtl | null
  autoCompactWindow?: number | null
  codexAutoCompactWindow?: number | null
  openCodeAutoCompactWindow?: number | null
  contextHandoffs?: boolean
  'stats.checkpointTokens'?: number | null
  'stats.checkpointShares.first'?: number
  'stats.checkpointShares.late'?: number
  'stats.checkpointShares.hard'?: number
}

/** Which CIs of the project the chain counts after a push of main, and how long it waits for them. */
export interface CiSettings {
  /** The chain keeps main green: waits for the CIs, runs the check, fixes a red main. `false` — none of it, the keys below kept but unused. */
  guard: boolean
  kinds: CiKind[]
  /** `null` — as long as it takes, `0` — not at all. */
  waitMinutes: number | null
  /** Without a CI to judge it, main that is not the tree checked before the merge is checked again before the next launch. */
  recheckMain: boolean
  /** A red main gets a fix task in the tracker; without it a session with no task fixes main (BTN-115). */
  fixTask: boolean
  /** The first red verdict on a commit reruns only its failed jobs, once, before a fix (BTN-846); green on the rerun — nothing to fix. */
  rerunFailed: boolean
}

/** The prompt cache lifetime a chain session is started with; the CLI picks its own without one. */
export type CacheTtl = '5m' | '1h'

export interface ContextScale {
  window: number
  warn: number
  danger: number
}

export interface StatsConfig {
  compare: CompareSettings
  /** Old folder → new folder: sessions in the old one count where it lives now. */
  moves: Record<string, string>
  /** A folder group costing less than this in all goes to Other on /stats. */
  otherBelow: number
  /** The agent-bridge hook's first threshold for every project without its own; null leaves it to the calibration. */
  checkpointTokens: number | null
  /** The shares of the session's window the checkpoint thresholds come at, for every project without its own. */
  checkpointShares: CheckpointShares
}

/**
 * Percents of a session's context window, `first < late < hard`: the first nudge, the late nudges and the hard
 * threshold of a held task come at most at them (BTN-261). A threshold pinned by `checkpointTokens` ignores them.
 */
export interface CheckpointShares {
  first: number
  late: number
  hard: number
}

/** A project's entry of the config as the settings panel edits it: the values it ends up with, the shared ones filled in. */
export interface ProjectForm extends ProjectSettings {
  /** What the page shows next to the key. `null` — no name. */
  name: string | null
  repo: string
  tracker: string
  /** The project's key in its tracker (`github`: `owner/name`, `linear`: a project of the team, `huly`: a Huly project other than the key); `null` — the tracker has none, or it is optional and not set. */
  trackerProject: string | null
  /** Slots of the pool; `0` — a worktree per task. */
  slot: number
  /** The palette slot the page draws the project with, 1–8 (BTN-207); `null` — none was free, grey. */
  color: number | null
  /** `null` — on exactly when no package of the project brings its tracker's MCP server. */
  brief: boolean | null
  /** The project's own over the shared ones; the keys of its tracker profile's rules it does not set itself are not in it. */
  chain: ChainRules
  /** The rule keys the project sets itself: the profile's rules go over the rest (BTN-334). */
  ownRules: (keyof ChainRules)[]
  /** The status moves the main tracker sets itself (BTN-554), over its profile's; none — it sets none. Read only: `project/moves` writes them. */
  moves?: StatusMoves
}

/** The shared keys of the config as the settings page edits them, defaults filled in. */
export interface SharedForm {
  protection?: Protection
  parallel: number
  brief: boolean | null
  chain: ChainRules
  provider: string
  /** By provider, defaults filled in; a blank one leaves the provider to its CLI's default. */
  models: Record<string, string>
  /** By provider, defaults filled in; `claude` is also switched from the header. */
  accounts: Record<string, string>
  execution: Record<string, string>
  /** By provider: `checked` or `system` (BTN-250). */
  cli: Record<string, string>
  modelLabels: boolean
  /** By the model's name as the CLI gets it. */
  modelPrompts: Record<string, string>
  /** Added to the prompt of every new session of every project, before the project's own; `null` — none. */
  prompt: string | null
  language: Language | null
  promptLanguage: Language
  hiddenSkills: string[]
  cacheTtl: CacheTtl | null
  autoCompactWindow: number | null
  codexAutoCompactWindow: number | null
  openCodeAutoCompactWindow: number | null
  /** For every project without its own (BTN-255); `false` — no handoffs by context size. */
  contextHandoffs: boolean
  /** Hours a waiting chain session's cache is kept warm (BTN-437); 0 — off. */
  keepWarm: number
  /** The largest attachment of a built-in task, megabytes (BTN-773). */
  attachmentLimit: number
  /** The project wizard's mode for a new project (BTN-886); `null` — not asked yet. */
  defaultGit: boolean | null
  /** The setup's steps gone past with no setting of their own (BTN-1023). */
  setupPassed: PassableStep[]
  /** The service checks a new CLI version and the checked one weekly (BTN-569). */
  cliCheck: boolean
  /** What a project without its own `ci` keys or `fillMilestone` runs on. */
  ci: CiSettings
  fillMilestone: boolean
  allowedHosts: string[]
  context: ContextScale
  stats: StatsConfig
  /** The switches of `updates`; the closed version is written by the toast, not the form. */
  updates: Pick<UpdateSettings, 'check' | 'notify'>
  /** Even Keel's `notices` entries (BTN-759), read only: `notices/mute` writes them, not the form. */
  notices?: Record<string, boolean>
}
