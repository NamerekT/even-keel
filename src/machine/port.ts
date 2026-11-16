import type { AfterGreenRun, Launched, LimitsWait, MainCheckRun, ModelWeekHold, PullCleanup } from '../chain/model.js'
import type { AccountNow, HandoffReason, HandoffSession, LimitedSession } from '../chain/relay.js'
import type { Changes, FinishOutcome } from '../git/types.js'
import type { OverageSession } from '../limits/overage-session.js'
import type { Notice } from '../notice/notice.js'

/**
 * Everything the hub's chain asks of the machine that runs the sessions (`docs/machines.md`, "The seam"). Today the
 * hub calls the one in-process implementation (`wireMachine`) directly; the link (`src/link/`) later carries each
 * member as its comment says:
 *
 * - **command** — hub → machine, numbered; its result comes back as an event;
 * - **query** — a command that changes nothing on the machine; its answer comes back as an event;
 * - **snapshot** — machine → hub: a field of the state the machine posts, which the hub then reads from its mirror.
 */
export interface MachinePort {
  // Commands: sessions.

  /**
   * Command. Starts a new session of the task; `fallback` in the result — the task's run named a provider without an
   * account in the pool. `extra` goes at the end of the prompt: the feedback on the task's pull request, or its pull
   * request closed unmerged.
   */
  launch: (project: string, task: string, extra?: string) => Promise<Launched>
  /** Command. Starts the session that fixes a red main without a task, in a place of its own; `report` says what broke, `reran` — see `SessionFix`. */
  launchFix: (project: string, name: string, report: string, reran?: boolean) => Promise<string>
  /** Command. Starts the session that resolves a release project's carry (BTN-369) in a place of its own; `report` says what conflicted. */
  launchCarry: (project: string, name: string, report: string) => Promise<string>
  /** Command. Resumes the session a limit stopped; returns the session id it came up under. */
  resume: (task: string, session: LimitedSession) => Promise<string>
  /** Command. Stops the waiting session and resumes it with the user's reply; returns the session id it came up under. */
  reply: (task: string, session: HandoffSession, prompt: string) => Promise<string>
  /** Command. Stops the session and starts a new one of the task in the same folder with the handoff prompt; returns its id. */
  relay: (task: string, session: HandoffSession, prompt: string, reason: HandoffReason) => Promise<string>
  /** Command. Stops a session, mid-turn too: a red main or detected subscription overage (invariant 1). */
  stop: (session: HandoffSession) => Promise<void>
  /** Query. The session with the folder it works in found on the machine's disk. */
  locate: (session: HandoffSession) => Promise<HandoffSession>

  // Commands: working folders and the repository.

  /** Command. Cleans up after the task; `pull` — after a task whose pull request was closed. */
  finish: (project: string, task: string, pull?: PullCleanup) => Promise<FinishOutcome>
  /** Command. Syncs the project's main the way the cleanup does (`syncMain`): the next try of a sync that could not reach a remote. */
  sync: (project: string) => Promise<Notice | null>
  /** Command. Prepares the place of the next task while the chain waits; its launch then reuses it. */
  prepare: (project: string, task: string) => Promise<void>
  /** Command. Runs the project's check on main in the place of the task about to start, which keeps it for the launch. */
  checkMain: (project: string, task: string, commit: string) => Promise<MainCheckRun>
  /** Command. Runs `commands.afterGreen` in the project's checkout, if it is on main at `commit`. */
  runAfterGreen: (project: string, commit: string) => Promise<AfterGreenRun>
  /** Query. The commit main is at in the project's checkout; `null` — unknown. */
  head: (project: string) => Promise<string | null>
  /** Query. The tree of a commit; `null` — unknown. */
  tree: (project: string, commit: string) => Promise<string | null>
  /** Query. Whether the branch of the task, or of the fix session, is in main with commits of its own. */
  merged: (project: string, task: string) => Promise<boolean>
  /** Query. Whether the project's main branch has the commit: the carry's release commit is in. */
  carried: (project: string, commit: string) => Promise<boolean>
  /** Query. What a session's working folder holds beyond main: commits ahead and uncommitted files. */
  changes: (project: string, workdir: string) => Promise<Changes>
  /** Query. The commits a red main's report lists up to `commit`, and which of `candidates` are green commits behind it. */
  history: (project: string, commit: string, candidates: string[]) => Promise<{ commits: string[]; greens: string[] }>
  /**
   * Query. Why the account `task` would start on refuses its model (`chain.unknownModel`), asked again while the chain
   * is paused on one so that the pause lifts once the model is fixed (BTN-679). Absent — such a pause waits for Resume.
   */
  modelBlock?: (project: string, task: string) => Promise<Notice | undefined>

  // Snapshot: sessions.

  /** Snapshot. The id of the task's session that has not finished. */
  liveSession: (task: string) => string | undefined
  /** Snapshot. The session of the task's newest entry in the launch journal; absent — the journal is not read. */
  lastSession?: (project: string, task: string) => string | undefined
  /** Snapshot. The task's session is mid-turn or waits on a question. */
  busy: (task: string) => boolean
  /** Snapshot. The task's session is mid-turn. */
  midTurn: (task: string) => boolean
  /**
   * Snapshot. The session's turn has ended and only its own background command runs (`shell`); `busy` and `midTurn`
   * count it until the command looks hung. A merged fix or a done task does not wait for it.
   */
  shell: (task: string) => boolean
  /** Snapshot. The id of the `AskUserQuestion` the task's session waits on, `null` for none. */
  asked: (task: string) => string | null
  /** Snapshot. Since when the task's working session has written nothing; `null` — it is not silent. */
  silentSince?: (task: string) => string | null
  /** Snapshot. The task's session as a limit stopped it. */
  limited: (task: string) => LimitedSession | undefined
  /** Snapshot. Fresh paid-usage or exhausted-allowance evidence for this working session. */
  overage?: (task: string) => OverageSession | undefined
  /** Snapshot. The task's session as a handover needs it: its folder, context, last reply. */
  handoff: (task: string) => HandoffSession | undefined
  /** Snapshot. A completed turn refused its model. Reporting it pauses the chain without touching the session. */
  modelRefusal?: (task: string, sessionId: string) => Notice | undefined
  /**
   * Snapshot. The monitor has read the sessions once since the service's start. Until then `busy`, `liveSession` and
   * the sessions a cleanup stops know nothing, so the chains do nothing rather than take a working session for a free
   * one (BTN-646).
   */
  sessionsRead: () => boolean
  /** Snapshot. The tree the check before the task's merge reported it passed on, with the project's commands now; `null` — no such report. */
  reportedTree: (project: string, task: string) => string | null

  // Snapshot: accounts, limits and packages.

  /** Snapshot. The account a new session of the project (or of `task`) would start on. */
  account: (project: string, task?: string) => AccountNow
  /** Snapshot. The account that was signed in to the folder `account` at `at`. */
  accountAt: (account: string, at: string) => string | null
  /** Snapshot. Why the account or the CLI `task` would start on holds a launch. */
  launchBlock: (project: string, task: string) => Notice | undefined
  /** Snapshot. When the spent limit of the account the project's session (or `task`'s) would start on resets; `null` — not spent. */
  limitReset: (project: string, task?: string) => string | null
  /**
   * Snapshot. The model's own week used up on the account the project's session (or `task`'s) would start on
   * (BTN-816): the chain holds the task until the week opens. `null` — no such week.
   */
  modelWeek?: (project: string, task?: string) => ModelWeekHold | null
  /** Snapshot. When the limit hit at `at` resets; a key's recovery may precede the spending reset in `text`. */
  limitResetAfter: (account: string, at: string, text?: string) => string | null
  /**
   * Snapshot. When a poll after the limit hit at `at` showed the account open before `resetsAt` for the model `task`
   * runs on now (BTN-530); `null` — it did not.
   */
  limitReopenedAt: (account: string, at: string, resetsAt: string, project: string, task: string) => string | null
  /**
   * Snapshot. The account the project's session (or `task`'s) would start on has not answered its first limits poll
   * since the service started: until then a spent limit looks like no limit at all (BTN-595). `undefined` — it has.
   */
  limitsUnread: (project: string, task?: string) => LimitsWait | undefined
  /**
   * Snapshot. The service has read its account folders once since its start. Until then every folder looks gone, so
   * the chains do nothing rather than pause on it; the first read checks them again.
   */
  accountsRead: () => boolean
  /**
   * Snapshot. The project's set of packages has a problem that holds its sessions (BTN-174): installing, no answer
   * yet, or the gateway down. The chain waits and the page says so (BTN-657).
   */
  packagesBlocked: (project: string) => boolean
  /**
   * Snapshot. A package of the set needs the user: not installed, failed to install or lacks a key
   * (`chain.packagesNotReady`, BTN-657). The chain pauses on it, except for a fix session of a red main, and goes on by
   * itself once it is fixed.
   */
  packagesPause: (project: string) => Notice | undefined
  /** Snapshot. The server of the project's tracker that no installed package brings; `undefined` — one does. */
  trackerMissing: (project: string) => string | undefined

  /**
   * Brings the snapshot members up to the machine's state now, before a step of the chain reads them: the port over the
   * link has the machine in this process post what changed (`docs/machines.md`, "The mirror"). Absent — the members
   * read the machine itself, or a machine elsewhere whose mirror is as fresh as its last event.
   */
  catchUp?: () => Promise<void>
}

/** The part of the port the check of main works through. */
export type MachineMainPort = Pick<MachinePort, 'head' | 'prepare' | 'reportedTree' | 'tree' | 'checkMain' | 'merged' | 'runAfterGreen' | 'history'>
