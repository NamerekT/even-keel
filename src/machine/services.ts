import type { LaunchEntry } from '../chain/model.js'
import type { HandoffSession } from '../chain/relay.js'
import type { ChatPast } from '../chats/prompt.js'
import type { Remote } from '../ci/remote.js'
import type { CloneProgress } from '../git/clone-progress.js'
import type { AccountControl } from '../server-control.js'
import type { HubBuild, MachineFollow } from '../link/view.js'
import type { Notice } from '../notice/notice.js'
import type { BranchShift } from '../projects/branch.js'
import type { Mail, MailReason } from '../sessions/mail.js'
import type { WarmPing } from '../sessions/warm-pings.js'
import type { MachineFacts } from './facts.js'
import type { FolderProbe, FolderSpec, FolderStep } from './folder-check.js'

/** A file read on the machine or sent to it, carried through the link whole as base64. */
export interface CarriedFile {
  type: string
  data: string
}

/** A file of a reply from the page, on its way to the session's folder. */
export interface CarriedInbox {
  name: string
  data: string
}

/** What the checkpoint hook reads of a session on the machine; the rest of its answer is the hub's. */
export interface SessionContext {
  /** The session's context as of the monitor's last poll; `null` — its transcript is not followed. */
  context: number | null
  /** Where Even Keel set the session to compact; `null` — the agent's own point. */
  compactAt: number | null
}

/** The page's and the hooks' reads of a session's transcript, made where the transcript is. */
export interface TranscriptReads {
  /** The session's record for the page; `undefined` — no account folder has it. */
  record(sessionId: string): Promise<unknown>
  /** Lines of the whole transcript from index `after` on, and its last turn. */
  feed(sessionId: string, after: number): Promise<unknown>
  /** Picture `index` of the result of call `tool`. */
  image(sessionId: string, tool: string, index: number): Promise<CarriedFile | undefined>
  /** A file the user sent the session, by its name. */
  inboxFile(sessionId: string, name: string): Promise<CarriedFile | undefined>
  /** File `index` the session sent the user by call `tool` (`SendUserFile`). */
  sharedFile(sessionId: string, tool: string, index: number): Promise<CarriedFile | undefined>
  /** The handoff note the session's turn wrote near its end; `null` — none, or no transcript. */
  note(sessionId: string): Promise<string | null>
  context(sessionId: string): Promise<SessionContext>
}

/** What a reply from the page does to a session's mailbox and folder on the machine (`createChat`). */
export interface MachineChat {
  post(task: string, sessionId: string, text: string, files: string[]): Promise<void>
  /** An answer that never reached its waiting session shows in the chat window as returned (BTN-1331). */
  giveBack(task: string, sessionId: string, text: string, files: string[], reason: MailReason): Promise<void>
  /** The returned messages of the session leave the chat window. */
  dismiss(sessionId: string): Promise<void>
  /** Puts the message into the working session that steers; `false` — it is not live there after all. */
  steer(task: string, session: HandoffSession, prompt: string): Promise<boolean>
  /**
   * Writes the message into the session's inbox socket (BTN-1322), delivered at once; `false` — no inbox known on the
   * machine, or it did not take the message: nothing is kept, and the reply goes the old way.
   */
  tell(task: string, sessionId: string, text: string, files: string[]): Promise<boolean>
  /** Saves the reply's files into the session's folder; their paths there. */
  saveInbox(project: string, workdir: string, files: CarriedInbox[]): Promise<string[]>
}

/** What a project chat's session runs with (BTN-1230): chosen at the chat's creation, sent whole with every call. */
export interface ChatStart {
  account: string
  /** As `SessionStart.model`. */
  model: string | null
  effort: string | null
  prompt: string
  /** The chat's own choice of packages over the project's set (BTN-1696); absent — none, or an older hub. */
  packages?: Record<string, boolean>
}

/**
 * A project chat's session on the machine where the project's folder is (`src/service/machine-chats.ts`): found by
 * the chat's id, which is its name, through the session monitor.
 */
export interface MachineChats {
  /** Starts the chat's first session in `folder`; its session id. */
  launch(project: string, folder: string, chat: string, start: ChatStart): Promise<string>
  /** The user's next message: into the live session, else a resume of it; a turn under way refuses it (`chats.busy`). */
  send(project: string, chat: string, start: Omit<ChatStart, 'account'>): Promise<string>
  /** Stops the chat's session, mid-turn too; one the monitor never saw is left alone. */
  stop(chat: string): Promise<void>
  /**
   * The title the agent or the user gave the chat's session, never the chat id it was launched under; `null` — none, or
   * an agent that gives none.
   */
  title(account: string, sessionId: string, chat: string): Promise<string | null>
  /**
   * The chat's session as the monitor knows it: its id, transcript and recent lines (BTN-1232); one the monitor no
   * longer lists is found by `sessionId` in the machine's account folders (BTN-1796). `null` — none.
   */
  past(chat: string, sessionId?: string): Promise<ChatPast | null>
  /**
   * `length` bytes from `from` of the chat's session transcript, at most `TRANSCRIPT_PART_BYTES`, with its whole size:
   * the hub carries it to the machine the chat goes on at (BTN-1711). A session the monitor no longer lists is found by
   * `sessionId`, as in `past`; a machine of an older build ignores it. `null` — no transcript known or readable.
   */
  transcriptPart(chat: string, from: number, length: number, sessionId?: string): Promise<TranscriptPart | null>
}

/** A piece of a transcript: the file's name and whole size, and the bytes asked for in base64. */
export interface TranscriptPart {
  name: string
  size: number
  data: string
}

/** The most of a transcript one answer carries: in base64 it stays under the link's limit of a machine's post. */
export const TRANSCRIPT_PART_BYTES = 4 * 1024 * 1024

/**
 * The records the hub keeps for the machine, handed to its own machine's new process before its monitor, hooks and chat
 * start. A machine elsewhere gets its `mail`, `chats` and its own `launches` of recent tasks (`machineJournal`) at each
 * connection (BTN-1699, BTN-1803); absent `launches` and `windows` leave the machine's as they are.
 */
export interface RetainedRecords {
  launches?: LaunchEntry[]
  windows?: [string, number][]
  mail: Mail[]
  /** The keep-warm pings of the last `MAX_KEEP_WARM_HOURS`, for the series a restart would lose (BTN-1507); absent — none handed. */
  warm?: WarmPing[]
  /** The machine's active project chats with a session, `[chat, sessionId]` (`ChatSessions`, BTN-1772); absent — none handed. */
  chats?: [string, string][]
}

/** The hub's records of the machine: its kept ones handed back, and a launch the hub's chain made there. */
export interface MachineRecordsService {
  restore(records: RetainedRecords): Promise<void>
  /** Into the machine's journal at once, so its facts and slots know the session before its next connection (BTN-1803). */
  launched(entry: LaunchEntry): Promise<void>
}

/**
 * A project's folder on the machine before the machine joins the project's pool (BTN-1271): each named with the
 * project and the folder, so the machine runs it only inside its folder of projects or a folder it agreed to.
 */
export interface MachineFolders {
  /** One check of the folder; `null` — it passed. */
  check(step: FolderStep, spec: FolderSpec): Promise<Notice | null>
  /**
   * Clones `source` into the folder, absent or empty, under its name and trusts it for Claude Code; the progress goes as
   * `CLONE_PROGRESS_EVENT`. `others`, the rest of the hub's remotes, are added by their names (BTN-1766): `git sync`
   * pushes to every remote of a checkout, so each machine's set is the hub's.
   */
  clone(spec: FolderSpec, source: Remote, others: Remote[]): Promise<void>
  /**
   * "Add remotes" of a clone already there (BTN-1806): the hub's remotes the folder lacks, added by their names, as a
   * fresh clone gets them. A folder that is not the project's clone is refused.
   */
  addRemotes(spec: Pick<FolderSpec, 'project' | 'folder' | 'remotes'>): Promise<void>
  /**
   * What the folder is to a project with these remotes before the machine is connected to it (BTN-1297). A project the
   * wizard has not made yet is named `DRAFT_PROJECT`: the machine runs it only inside its folder of projects.
   */
  probe(spec: Pick<FolderSpec, 'project' | 'folder' | 'remotes'>): Promise<FolderProbe>
}

/** The project a probe of the wizard names before the project is made: no machine agreed to it. */
export const DRAFT_PROJECT = 'draft'

/** The event of a clone's progress on the machine. */
export const CLONE_PROGRESS_EVENT = 'folders.progress'

export interface CloneTold {
  project: string
  folder: string
  progress: CloneProgress
}

/** How often a clone's progress goes to the hub within one stage: each event is a row of the machine's outbox. */
export const CLONE_TELL_MS = 500

/** The progress told at most once per `CLONE_TELL_MS`, and at once when the stage changes. */
export function cloneTold(tell: (payload: CloneTold) => void, now: () => number = Date.now): (project: string, folder: string, progress: CloneProgress) => void {
  let last: { stage: string; at: number } | undefined
  return (project, folder, progress) => {
    const at = now()
    if (last !== undefined && last.stage === progress.stage && at - last.at < CLONE_TELL_MS) return
    last = { stage: progress.stage, at }
    tell({ project, folder, progress })
  }
}

/** Git's `user.name` and `user.email` on the machine as git reads them; `null` — unset. */
export interface GitIdentity {
  name: string | null
  email: string | null
}

/** The machine's git as the hub's page sets it (BTN-1503). */
export interface MachineGit {
  /** `git config --global` of the user Even Keel runs as there; what git reads back, for the machine's report. */
  identity(name: string, email: string): Promise<GitIdentity>
}

/** The project's folder on the machine and the project's main branch (BTN-1567): moved with the hub's checkout. */
export interface MachineBranch {
  /** Fetches, then puts the project's folder on `branch` by the hub's rules (`branchMove`); what undoes it. */
  move(project: string, branch: string): Promise<BranchShift>
  /** Undoes a `move`: the folder goes back where it stood, and a branch the move made is dropped. */
  back(project: string, branch: string, shift: BranchShift): Promise<void>
}

/** The parts of the facts of a task's sessions that `factsScope` may leave out on a machine elsewhere (BTN-1561). */
export type TaskSessionsHere = Required<Pick<MachineFacts, 'sessions' | 'owners' | 'compactions'>>

/** What the hub's history window asks of a machine (BTN-1561): the facts no longer tell an old task's sessions. */
export interface MachineHistory {
  /** The views, account folders and compactions of the task's sessions and of `sessionIds`, the hub's runs of it. */
  task(task: string, sessionIds: string[]): Promise<TaskSessionsHere>
}

/** The machine's own installation (BTN-1609): it comes to the hub's build through its update process. */
export interface MachineUpdate {
  /**
   * Launches the update to the hub's build (`HubFollower.asked`); `force` — the person's "Update", which tries again a
   * target an update failed at. `null` — it moves, one runs already, or it runs that build; else what keeps it.
   */
  follow(build: HubBuild, force: boolean): Promise<MachineFollow | null>
}

/**
 * What the hub's page, hooks and chat ask of a machine besides the chain's port (`docs/machines/seam.md`, "The seam"): each
 * member is the link's command `<group>.<member>` with `{args}`, its value in `command.done` as for `port.*`.
 */
export interface MachineServices {
  account: AccountControl
  transcript: TranscriptReads
  chat: MachineChat
  records: MachineRecordsService
  folders: MachineFolders
  chats: MachineChats
  git: MachineGit
  branch: MachineBranch
  update: MachineUpdate
  history: MachineHistory
}

export const SERVICE_COMMANDS = {
  account: [
    'discoverGlobal', 'useGlobal', 'add', 'addApiKey', 'addCloud', 'addLongToken', 'readAws', 'readGcloud', 'readAzure', 'replaceApiKey',
    'setManagementKey', 'renew', 'switchTo', 'switchApp', 'remove', 'keep', 'rename', 'resolveSettingsEdit', 'dropOwnSetting', 'enableRemote', 'code', 'cancel',
    'installCli', 'checkClis',
  ],
  transcript: ['record', 'feed', 'image', 'inboxFile', 'sharedFile', 'note', 'context'],
  chat: ['post', 'giveBack', 'dismiss', 'steer', 'tell', 'saveInbox'],
  records: ['restore', 'launched'],
  folders: ['check', 'clone', 'addRemotes', 'probe'],
  chats: ['launch', 'send', 'stop', 'title', 'past', 'transcriptPart'],
  git: ['identity'],
  branch: ['move', 'back'],
  update: ['follow'],
  history: ['task'],
} as const satisfies { [G in keyof MachineServices]: ReadonlyArray<keyof MachineServices[G]> }

type Group = keyof MachineServices
type Unlisted = { [G in Group]: Exclude<keyof MachineServices[G], (typeof SERVICE_COMMANDS)[G][number]> }[Group]
/** Every member of every group has its command: a new one left out of `SERVICE_COMMANDS` fails the build. */
const complete: [Unlisted] extends [never] ? true : Unlisted = true
void complete

type Member = (...args: unknown[]) => unknown

const groups = Object.entries(SERVICE_COMMANDS) as Array<[Group, readonly string[]]>

/** The type of every service command, `<group>.<name>`. */
export const SERVICE_TYPES: ReadonlySet<string> = new Set(groups.flatMap(([group, names]) => names.map((name) => `${group}.${name}`)))

/** The machine's side: the handler of each command, by its type. */
export function serviceHandlers(services: MachineServices): Map<string, Member> {
  const handlers = new Map<string, Member>()
  for (const [group, names] of groups) {
    const target = services[group] as unknown as Record<string, Member>
    for (const name of names) handlers.set(`${group}.${name}`, (...args) => target[name]!.apply(target, args))
  }
  return handlers
}

/** The hub's side: every member sends its command through `ask` and resolves with the machine's value. */
export function remoteServices(ask: (group: Group, name: string, args: unknown[]) => Promise<unknown>): MachineServices {
  const services: Record<string, Record<string, Member>> = {}
  for (const [group, names] of groups) {
    services[group] = Object.fromEntries(names.map((name) => [name, (...args: unknown[]) => ask(group, name, args)]))
  }
  return services as unknown as MachineServices
}

export const toCarried = (type: string, data: Uint8Array): CarriedFile => ({ type, data: Buffer.from(data).toString('base64') })
export const fromCarried = (file: { data: string }): Buffer => Buffer.from(file.data, 'base64')
