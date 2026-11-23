import type { LaunchEntry } from '../chain/model.js'
import type { HandoffSession } from '../chain/relay.js'
import type { ChatPast } from '../chats/prompt.js'
import type { CloneProgress } from '../git/clone-progress.js'
import type { AccountControl } from '../server-control.js'
import type { Notice } from '../notice/notice.js'
import type { Mail, MailReason } from '../sessions/mail.js'
import type { WarmPing } from '../sessions/warm-pings.js'
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
  /** The chat's session as the monitor knows it: its id, transcript and recent lines; `null` — none (BTN-1232). */
  past(chat: string): Promise<ChatPast | null>
}

/** The records the hub keeps for the machine, handed to its new process before its monitor, hooks and chat start. */
export interface RetainedRecords {
  launches: LaunchEntry[]
  windows: [string, number][]
  mail: Mail[]
  /** The keep-warm pings of the last `MAX_KEEP_WARM_HOURS`, for the series a restart would lose (BTN-1507); absent — none handed. */
  warm?: WarmPing[]
}

/**
 * A project's folder on the machine before the machine joins the project's pool (BTN-1271): each named with the
 * project and the folder, so the machine runs it only inside its folder of projects or a folder it agreed to.
 */
export interface MachineFolders {
  /** One check of the folder; `null` — it passed. */
  check(step: FolderStep, spec: FolderSpec): Promise<Notice | null>
  /** Clones `remote` into the folder, absent or empty, and trusts it for Claude Code; the progress goes as `CLONE_PROGRESS_EVENT`. */
  clone(spec: FolderSpec, remote: string): Promise<void>
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

/**
 * What the hub's page, hooks and chat ask of a machine besides the chain's port (`docs/machines.md`, "The seam"): each
 * member is the link's command `<group>.<member>` with `{args}`, its value in `command.done` as for `port.*`.
 */
export interface MachineServices {
  account: AccountControl
  transcript: TranscriptReads
  chat: MachineChat
  records: { restore(records: RetainedRecords): Promise<void> }
  folders: MachineFolders
  chats: MachineChats
  git: MachineGit
}

export const SERVICE_COMMANDS = {
  account: [
    'discoverGlobal', 'useGlobal', 'add', 'addApiKey', 'addCloud', 'addLongToken', 'readAws', 'readGcloud', 'readAzure', 'replaceApiKey',
    'setManagementKey', 'renew', 'switchTo', 'switchApp', 'remove', 'keep', 'rename', 'resolveSettingsEdit', 'dropOwnSetting', 'enableRemote', 'code', 'cancel',
    'installCli', 'checkClis',
  ],
  transcript: ['record', 'feed', 'image', 'inboxFile', 'sharedFile', 'note', 'context'],
  chat: ['post', 'giveBack', 'dismiss', 'steer', 'tell', 'saveInbox'],
  records: ['restore'],
  folders: ['check', 'clone', 'probe'],
  chats: ['launch', 'send', 'stop', 'title', 'past'],
  git: ['identity'],
} as const satisfies { [G in keyof MachineServices]: ReadonlyArray<keyof MachineServices[G]> }

type Group = keyof MachineServices
type Unlisted = { [G in Group]: Exclude<keyof MachineServices[G], (typeof SERVICE_COMMANDS)[G][number]> }[Group]
/** Every member of every group has its command: a new one left out of `SERVICE_COMMANDS` fails the build. */
const complete: [Unlisted] extends [never] ? true : Unlisted = true
void complete

type Member = (...args: unknown[]) => unknown

const groups = Object.entries(SERVICE_COMMANDS) as Array<[Group, readonly string[]]>

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
