import type { AccountHome } from '../account/homes.js'
import type { SessionStart } from '../agent/contract.js'
import type { HandoffSession } from '../chain/relay.js'
import { DEFAULT_BRANCH, idPrefixOf, isPlain, ownerOf, readersOf } from '../config.js'
import { withCredentials, type GitCredential } from '../git/credentials.js'
import { remoteCallsInTurn } from '../git/in-turn.js'
import { runGit } from '../git/run.js'
import type { Git } from '../git/types.js'
import { projectOfFolder } from './git-credentials.js'
import type { SlotUse } from '../git/slot.js'
import { AccountIdentities } from '../limits/identity.js'
import { folderHere } from '../machine/account-here.js'
import { BriefCopy } from '../machine/brief.js'
import { MachineConfig, SELECTION_EVENT, type CliChoices } from '../machine/config.js'
import { setMachineValue } from '../machine/state.js'
import type { Notice } from '../notice/notice.js'
import type { ServiceContext } from '../service.js'
import { handoffNoteOf } from '../sessions/note.js'
import type { Occupant } from '../sessions/occupants.js'
import type { SetupRun } from '../sessions/setup.js'
import { Writes } from '../storage/database.js'
import { TASKS_SERVER } from '../taskmcp/server.js'
import { createChatSettings, createSessionSettings } from '../tools/sessionSettings.js'
import { parseTaskId } from '../tracker/model.js'
import { wireAgentExtras, wireChoiceFor, wireNoAccountFor, wirePlanFor } from './accounts.js'
import { launchBriefs, wireWithProject } from './chain-prompts.js'
import { stopTaskSessions } from './cleanup.js'
import { foldersHere } from './folders-here.js'
import * as chain from './machine-chain.js'
import type { MachineHost } from './machine-host.js'

export type { MachineHost }

/** What the machine tells the hub besides the chain's results: each is an event of the link (`docs/machines.md`). */
export interface MachineTell {
  record(type: string, payload: unknown): Promise<void>
  /** A cleanup the machine finished late left something on the task: the hub shows it on the task's row. */
  leftover(project: string, task: string, notice: Notice): void
  /** A session's transcript changed: the page's open feed reads it again. */
  transcript(sessionId: string): void
  /** Something the page shows of the machine changed: its facts go to the hub's mirror. */
  changed(): void
  /** The tokens of a project's HTTPS remotes for one git call, asked of the hub (BTN-1541); `[]` — none or no link. */
  credentials(project: string, urls: readonly string[]): Promise<GitCredential[]>
}

export type LaterTell = MachineTell & { connect(tell: MachineTell): void }

/** The machine's own derived reads: computed from the brief, never from the hub's objects. */
export interface MachineOwn {
  brief: BriefCopy
  configStore: MachineConfig
  activeAccount(): string
  machineChanged(): void
  /** What the hub's trackers read (BTN-66), from the brief's config. */
  readers: () => ReturnType<typeof readersOf>
  tell: LaterTell
  /** The machine's writes in flight, settled before it closes. */
  writes: Writes
  /** Git whose calls to a project's HTTPS remotes take its profile's token from the hub (BTN-1541, `withCredentials`). */
  git: Git
  briefed: ReturnType<typeof launchBriefs>
  branchOf: (project: string) => string
  pullRequestsOn: (project: string) => boolean
  promptLanguage: ServiceContext['promptLanguage']
  projectOf: (task: string) => string | undefined
  runOfTask: (project: string | undefined, task: string) => ReturnType<BriefCopy['runOf']>
  choiceFor: ReturnType<typeof wireChoiceFor>
  planFor: ReturnType<typeof wirePlanFor>
  agentExtras: ReturnType<typeof wireAgentExtras>
  noAccountFor: ReturnType<typeof wireNoAccountFor>
  settingsFor: ReturnType<typeof createSessionSettings>
  chatSettingsFor: ReturnType<typeof createChatSettings>
  withProject: ReturnType<typeof wireWithProject>
  taskNote: (task: string) => string
  slotsSeen: Map<string, number>
  slotSpan: (project: string) => number
  slotUse: (slot: string, task: string) => SlotUse
  occupantsOf: (slot: string, task: string) => { idle: Occupant[]; busy: Occupant[] }
  vacateSlot: (slot: string, task: string, shared?: boolean) => Promise<void>
  stopTaskSessions: (project: string, repo: string, task: string, count: number, shared?: boolean) => ReturnType<typeof stopTaskSessions>
  taskRun: (task: string, cwd: string, account: string) => SetupRun
  syncProject: (project: string) => Promise<Notice | null>
  resumeWith: (task: string, session: HandoffSession, prompt: string) => Promise<string>
  approved: (task: string, session: HandoffSession, prompt: string) => boolean
  /** The user's message into the session's inbox socket (`chain.toldInbox`, BTN-1322); `false` — it goes another way. */
  toldInbox: (task: string, session: HandoffSession, prompt: string) => Promise<boolean>
  goOnWith: (home: AccountHome, task: string, session: HandoffSession, prompt: string) => Promise<SessionStart>
}

export type MachineContext = MachineHost & MachineOwn

function lazy<K extends keyof MachineOwn>(target: MachineOwn, name: K, make: () => MachineOwn[K]): void {
  let made: MachineOwn[K] | undefined
  Object.defineProperty(target, name, { enumerable: true, get: () => (made ??= make()) })
}

/** A tell that has nowhere to go yet: the link is wired after the objects that tell it. */
export function laterTell(): LaterTell {
  let to: MachineTell | undefined
  return {
    connect: (tell) => void (to = tell),
    record: (type, payload) => to === undefined ? Promise.reject(new Error(`machine: no link for ${type}`)) : to.record(type, payload),
    leftover: (project, task, notice) => {
      if (to === undefined) console.warn(`machine: what the cleanup left on ${task} has no link to go over yet: ${notice.code}`)
      else to.leftover(project, task, notice)
    },
    transcript: (sessionId) => to?.transcript(sessionId),
    changed: () => to?.changed(),
    credentials: async (project, urls) => (to === undefined ? [] : to.credentials(project, urls)),
  }
}

/**
 * The machine's context (`docs/machines/seam.md`, "The machine's context"): the host's objects and, from the hub's brief, the
 * config, the tasks' runs and lists and the chain's switches. Read lazily: the host's objects are made after it.
 */
export function machineContext(host: MachineHost, brief: BriefCopy, tell: LaterTell, cli: CliChoices = {}): MachineContext {
  const writes = new Writes((line) => console.warn(line))
  const configStore = new MachineConfig(brief, cli,
    (choices) => writes.add('the machine CLI choices', setMachineValue(host.machineDb, 'cli', choices)),
    (selection) => writes.add('the machine selection', tell.record(SELECTION_EVENT, selection)))
  const config = () => configStore.current
  const readers = (): ReturnType<typeof readersOf> => readersOf(config())
  const own = {
    brief,
    configStore,
    activeAccount: () => config().accounts[config().provider]!,
    machineChanged: () => tell.changed(),
    readers,
    tell,
    writes,
    // A landing and a forward to another machine's push meet in the main checkout (BTN-1720): their fetches go in turn.
    git: remoteCallsInTurn(
      withCredentials(runGit, async (folder, urls) => {
        const project = projectOfFolder(config().projects, folder)
        return project === undefined ? [] : tell.credentials(project, urls)
      }),
    ),
    briefed: launchBriefs(),
    branchOf: (project) => config().settings[project]?.branch ?? DEFAULT_BRANCH,
    pullRequestsOn: (project) => config().settings[project]?.pullRequests ?? false,
    promptLanguage: (project) => (project === undefined ? undefined : config().settings[project]?.promptLanguage) ?? config().promptLanguage,
    projectOf: (task) => brief.projectOf(task),
    runOfTask: (project, task) => brief.runOf(project, task),
    noAccountFor: wireNoAccountFor(),
    taskNote: (task) => {
      const listed = brief.projectOf(task)
      const prefix = parseTaskId(task)?.project
      const reader = listed === undefined ? Object.keys(readers().projects).find((each) => idPrefixOf(readers(), each) === prefix) : undefined
      const project = listed ?? (reader === undefined ? undefined : ownerOf(readers(), reader))
      const kept = project !== undefined && host.packages.bringsServer(project, TASKS_SERVER)
      return handoffNoteOf(task, project === undefined || !isPlain(config(), project), kept)
    },
    slotsSeen: new Map(),
    slotSpan: (project) => chain.slotSpan(ctx, project),
    slotUse: (slot, task) => chain.slotUse(ctx, slot, task),
    occupantsOf: (slot, task) => chain.occupantsOf(ctx, slot, task),
    vacateSlot: (slot, task, shared = false) => chain.vacateSlot(ctx, slot, task, shared),
    stopTaskSessions: (project, repo, task, count, shared = false) => stopTaskSessions(ctx, project, repo, task, count, shared),
    taskRun: (task, cwd, account) => chain.taskRun(ctx, task, cwd, account),
    syncProject: (project) => chain.syncProject(ctx, project),
    resumeWith: (task, session, prompt) => chain.resumeWith(ctx, task, session, prompt),
    approved: (task, session, prompt) => chain.approved(ctx, task, session, prompt),
    toldInbox: (task, session, prompt) => chain.toldInbox(ctx, task, session, prompt),
    goOnWith: (home: AccountHome, task: string, session: HandoffSession, prompt: string) => chain.goOnWith(ctx, home, task, session, prompt),
  } as MachineOwn
  const identities = new AccountIdentities()
  const choosing = {
    get homes() { return host.homes },
    get hasAccount() { return host.hasAccount },
    projectOf: own.projectOf,
    configStore,
    runOfTask: own.runOfTask,
    demo: { owns: (project: string | undefined) => brief.demoOwns(project) },
    folderOf: (key: string) => folderHere(brief.accountOf(key), key, foldersHere(host, identities)),
  }
  // Made at their first read: the host's homes and packages are opened after this context is.
  lazy(own, 'choiceFor', () => wireChoiceFor(choosing))
  lazy(own, 'planFor', () => wirePlanFor({ ...choosing, homes: host.homes, hasAccount: host.hasAccount, unattended: () => brief.unattended, promptLanguage: own.promptLanguage }))
  lazy(own, 'agentExtras', () => wireAgentExtras({ configStore, runOfTask: own.runOfTask, branchOf: own.branchOf, packages: host.packages }))
  lazy(own, 'settingsFor', () => createSessionSettings({ config, packages: host.packages, globalDir: host.homes.global.dir, trim: () => brief.trimTools, projectOf: own.projectOf, git: runGit, branchOf: own.branchOf }))
  lazy(own, 'chatSettingsFor', () => createChatSettings({ config, packages: host.packages, globalDir: host.homes.global.dir }))
  lazy(own, 'withProject', () => wireWithProject({ configStore, promptLanguage: own.promptLanguage }))
  const ctx = new Proxy(own, {
    get: (target, name: string) => (name in target ? target[name as keyof MachineOwn] : host[name as keyof MachineHost]),
    set: (target, name, value) => Reflect.set(name in target ? target : host, name, value),
  }) as MachineContext
  return ctx
}
