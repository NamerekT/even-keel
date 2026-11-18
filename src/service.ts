import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { type AccountHome } from './account/homes.js'
import type { SessionStart } from './agent/contract.js'
import { attachBuiltin } from './builtin/adapter.js'
import { attachmentsDirOf,SWEEP_EVERY_MS,sweepAttachments } from './builtin/files.js'
import { BuiltinStore } from './builtin/store.js'
import { CheckReports } from './chain/checkreports.js'
import { type LaunchEntry } from './chain/dispatcher.js'
import { launchedProjects } from './chain/launches.js'
import { type HandoffSession } from './chain/relay.js'
import { closedTasks,loadQuestions,readLaunches,type ClosedTask } from './chain/store.js'
import { gitlabUrls } from './ci/adapters.js'
import { type Remote } from './ci/remote.js'
import { CLAUDE } from './claude/name.js'
import { DEFAULT_BRANCH,gitProjects,isPlain,listenOf,mcpPortOf,ownerOf,projectLabels,readersOf,type EvenKeelConfig } from './config.js'
import { EventHub, readyBroadcast } from './events.js'
import { runGit } from './git/run.js'
import { gitSetup } from './git/setup.js'
import { type SlotUse } from './git/slot.js'
import { guardToken } from './guard.js'
import { hulyClient,installForProfiles } from './huly/client.js'
import type { IntakeEntry } from './intake/model.js'
import { stepJobs } from './jobs/runner.js'
import { loadEnv,root,stateDirOf } from './locations.js'
import { englishOf,noticeOf,withLabels,type Notice } from './notice/notice.js'
import { profileKinds } from './profiles/model.js'
import { Profiles } from './profiles/service.js'
import { ProjectRemotes } from './projects/remotes.js'
import { type RemovalFacts } from './projects/removal.js'
import { pullReadiness } from './review/open.js'
import { PullRefusals } from './review/refusals.js'
import { type ChainControl } from './server.js'
import * as accountsService from './service/accounts.js'
import * as chainService from './service/chain.js'
import { CHATS_SWEEP_MS, wireProjectChats } from './service/chats.js'
import { ACCOUNT_POLL_MS,AGENT_TIMEOUT_MS,CHANGELOG_TIMEOUT_MS,CI_TARGETS_MS,CI_TICK_MS,CI_TIMEOUT_MS,CLI_VERSION_POLL_MS,CONFIG_POLL_MS,FALLBACK_TOAST_MS,FORWARD_TICK_MS,INTAKE_TICK_MS,LAUNCH_CHART_DAYS,LIMIT_CHECK_MS,LIMITS_POLL_MS,NETWORK_PROBE_MS,OFFLINE_RETRY_MS,OWNERS_RESCAN_MS,PLUGIN_UPDATE_TIMEOUT_MS,SESSION_POLL_MS,SHUTDOWN_MS,TALLY_FIRST_DELAY_MS,TALLY_INTERVAL_MS,TRACKER_CHECK_MS,UPDATE_POLL_MS,USAGE_POLL_MS,WINDOW_RECHECK_MS,WORK_TICK_MS,WORK_TTL_MS } from './service/defaults.js'
import * as demoService from './service/demo.js'
import * as hostingService from './service/hosting.js'
import * as hubBootstrap from './service/hub-bootstrap.js'
import * as lifecycleService from './service/lifecycle.js'
import { startTicks } from './service/ticks.js'
import { wireLinkedMachine, type LinkedMachine } from './service/machine-link.js'
import { laterTell } from './service/machine-context.js'
import { assembleMachineHost, type MachineHost } from './service/machine-host.js'
import * as statsService from './service/stats.js'
import * as trackersService from './service/trackers.js'
import { type AgentEntry } from './sessions/agents.js'
import { createChat } from './sessions/chat.js'
import { settleMail } from './sessions/mailRelay.js'
import { handoffNoteOf } from './sessions/note.js'
import { TASKS_SERVER } from './taskmcp/server.js'
import { loadRareEvents,pruneRareEvents,rareEvents,saveRareEvent } from './sessions/rare.js'
import { type SetupRun } from './sessions/setup.js'
import type { EvenKeelState,ProjectForm } from './state.js'
import { tallyKey } from './stats/mode.js'
import { takeStartFailure } from './storage/backup-schedule.js'
import { loadBrowserHotkeys } from './storage/browser-hotkeys.js'
import { Writes } from './storage/database.js'
import { keptDatabase } from './storage/owner.js'
import { stateValue } from './storage/service-state.js'
import { MACHINE_DIR, openMachineDatabase } from './link/machine-store.js'
import { importMachineStores } from './machine/state.js'
import { VACUUM_EVERY_MS,vacuumDatabase } from './storage/vacuum.js'
import { ADAPTERS } from './tracker/adapters.js'
import { PendingCloses } from './tracker/close.js'
import { loadMergeMarks,MergeMarks,saveMergeMark } from './tracker/closes.js'
import type { TrackerLink } from './tracker/link.js'
import { type ParentTask,type Task } from './tracker/model.js'
import type { TemplateHit } from './tracker/templates.js'
import { updatesView } from './updates/release.js'
import { installed } from './updates/watcher.js'

export type ServiceContext = typeof context

/** Live bindings keep callbacks lazy across initialization and later state/config changes. */
const context = {
  get stateChanged() { return stateChanged },
  get attachmentsDir() { return attachmentsDir },
  get importedAdapters() { return importedAdapters },
  get trackerProfiles() { return trackerProfiles },
  get moveRunLabels() { return moveRunLabels },
  get startChain() { return startChain },
  get SWITCHES() { return SWITCHES },
  get reach() { return reach },
  get accountFile() { return accountFile },
  get ACCOUNT_POLL_MS() { return ACCOUNT_POLL_MS },
  get AGENT_TIMEOUT_MS() { return AGENT_TIMEOUT_MS },
  get CHANGELOG_TIMEOUT_MS() { return CHANGELOG_TIMEOUT_MS },
  get CI_TIMEOUT_MS() { return CI_TIMEOUT_MS },
  get CLI_VERSION_POLL_MS() { return CLI_VERSION_POLL_MS },
  get CONFIG_POLL_MS() { return CONFIG_POLL_MS },
  get FALLBACK_TOAST_MS() { return FALLBACK_TOAST_MS },
  get LAUNCH_CHART_DAYS() { return LAUNCH_CHART_DAYS },
  get LIMITS_POLL_MS() { return LIMITS_POLL_MS },
  get NETWORK_PROBE_MS() { return NETWORK_PROBE_MS },
  get OFFLINE_RETRY_MS() { return OFFLINE_RETRY_MS },
  get OWNERS_RESCAN_MS() { return OWNERS_RESCAN_MS },
  get PLUGIN_UPDATE_TIMEOUT_MS() { return PLUGIN_UPDATE_TIMEOUT_MS },
  get SESSION_POLL_MS() { return SESSION_POLL_MS },
  get SHUTDOWN_MS() { return SHUTDOWN_MS },
  get TALLY_FIRST_DELAY_MS() { return TALLY_FIRST_DELAY_MS },
  get TALLY_INTERVAL_MS() { return TALLY_INTERVAL_MS },
  get TRACKER_CHECK_MS() { return TRACKER_CHECK_MS },
  get UPDATE_POLL_MS() { return UPDATE_POLL_MS },
  get USAGE_POLL_MS() { return USAGE_POLL_MS },
  get WINDOW_RECHECK_MS() { return WINDOW_RECHECK_MS },
  get WORK_TTL_MS() { return WORK_TTL_MS },
  get account() { return account },
  get accountNow() { return accountNow },
  get activeAccount() { return activeAccount },
  get agentExtras() { return machine.agentExtras },
  get agentOf() { return agentOf },
  get badges() { return badges },
  get agentStatus() { return agentStatus },
  get agents() { return machineHost.agents },
  set agents(value: MachineHost['agents']) { machineHost.agents = value },
  get agentsRead() { return machineHost.agentsRead },
  set agentsRead(value: boolean) { machineHost.agentsRead = value },
  get answerSession() { return answerSession },
  get applyCi() { return applyCi },
  get applyGuard() { return applyGuard },
  get applyTally() { return applyTally },
  get approvals() { return approvals },
  get approved() { return approved },
  get archive() { return archive },
  get archiveClosed() { return archiveClosed },
  get backups() { return backups },
  get branchOf() { return branchOf },
  get briefOn() { return briefOn },
  get briefed() { return briefed },
  get chainControl() { return chainControl },
  get changelogs() { return changelogs },
  get chatTitles() { return chatTitles },
  get checkMergeTarget() { return checkMergeTarget },
  get checkReports() { return checkReports },
  get choiceFor() { return choiceFor },
  get ciOn() { return ciOn },
  get ciTokenOf() { return ciTokenOf },
  get ciWatches() { return ciWatches },
  get claudeAccount() { return claudeAccount },
  get claudeConfigs() { return claudeConfigs },
  get cliChecks() { return cliChecks },
  get cliCopies() { return cliCopies },
  get cliLease() { return cliLease },
  get cliVersions() { return cliVersions },
  get configStore() { return configStore },
  get configuredProject() { return configuredProject },
  get contextWindows() { return contextWindows },
  get daemons() { return daemons },
  get db() { return db },
  get machineDb() { return machineDb },
  get demo() { return demo },
  get dismissedUpdate() { return dismissedUpdate },
  set dismissedUpdate(value: typeof dismissedUpdate) { dismissedUpdate = value },
  get dismissedNotices() { return dismissedNotices },
  set dismissedNotices(value: typeof dismissedNotices) { dismissedNotices = value },
  get browserHotkeys() { return browserHotkeys },
  set browserHotkeys(value: typeof browserHotkeys) { browserHotkeys = value },
  get dispatcher() { return dispatcher },
  get emailAt() { return emailAt },
  get eventLog() { return eventLog },
  get envChanged() { return envChanged },
  get envFile() { return envFile },
  get envOf() { return envOf },
  get feedOf() { return feedOf },
  get forwards() { return forwards },
  // Not a getter: a handler wired before `getState` is declared may pass it on during the start (EKR-52).
  getState: () => getState(),
  get goOnWith() { return goOnWith },
  get hasAccount() { return hasAccount },
  get homeOf() { return homeOf },
  get homes() { return homes },
  get accountSettings() { return accountSettings },
  get hub() { return hub },
  get importedProfiles() { return importedProfiles },
  get inHomes() { return inHomes },
  get intakeEntries() { return intakeEntries },
  get intakePlaces() { return intakePlaces },
  get intakeTemplateHits() { return intakeTemplateHits },
  get keepWarm() { return keepWarm },
  get machineLink() { return machineLink },
  get machineChanged() { return machineChanged },
  get keyOrganizations() { return keyOrganizations },
  get keySpend() { return keySpend },
  get knownTask() { return knownTask },
  get runOfTask() { return runOfTask },
  get runsOfProject() { return runsOfProject },
  get setTaskRun() { return setTaskRun },
  get taskRuns() { return taskRuns },
  get launchIn() { return launchIn },
  get launches() { return launches },
  get journal() { return journal },
  get ledger() { return machineHost.ledger },
  set ledger(value: MachineHost['ledger']) { machineHost.ledger = value },
  get limitRetries() { return limitRetries },
  get limits() { return limits },
  get limitsFile() { return limitsFile },
  get linkFor() { return linkFor },
  get linkOf() { return linkOf },
  get lingering() { return lingering },
  get links() { return links },
  get listen() { return listen },
  set listen(value: typeof listen) { listen = value },
  get listenError() { return listenError },
  set listenError(value: typeof listenError) { listenError = value },
  get liveView() { return liveView },
  get lockedReaders() { return lockedReaders },
  get logStartupDialogs() { return logStartupDialogs },
  get mailRelay() { return mailRelay },
  get mailbox() { return mailbox },
  get managementKeys() { return managementKeys },
  get mcpPort() { return mcpPort },
  get memory() { return memory },
  get mergeMarks() { return mergeMarks },
  get pendingCloses() { return pendingCloses },
  set mcpPort(value: typeof mcpPort) { mcpPort = value },
  get models() { return models },
  get monitor() { return monitor },
  get newTally() { return newTally },
  get noAccountFor() { return noAccountFor },
  get occupantsOf() { return occupantsOf },
  get online() { return online },
  get ownerOfReader() { return ownerOfReader },
  get owners() { return owners },
  get packages() { return packages },
  get packageHub() { return packageHub },
  get pinnedCheckpoint() { return pinnedCheckpoint },
  get places() { return places },
  get planFor() { return machine.planFor },
  get postedQuestions() { return postedQuestions },
  get profileBlock() { return profileBlock },
  get profileKindsOf() { return profileKindsOf },
  get profiles() { return profiles },
  get projectChats() { return projectChats },
  get projectOf() { return projectOf },
  get projectsChanged() { return projectsChanged },
  get promptLanguage() { return promptLanguage },
  get protectionAudit() { return protectionAudit },
  get pullBlock() { return pullBlock },
  get pullReadinessOf() { return pullReadinessOf },
  get pullRefusals() { return pullRefusals },
  get pullRequestsOn() { return pullRequestsOn },
  get readerFor() { return readerFor },
  get readerMoves() { return readerMoves },
  get readerRules() { return readerRules },
  get readerTasks() { return readerTasks },
  get readers() { return readers },
  get rebind() { return rebind },
  get refreshProject() { return refreshProject },
  get refreshers() { return refreshers },
  get release() { return release },
  get releasesView() { return releasesView },
  get remotes() { return remotes },
  get removalFacts() { return removalFacts },
  get branches() { return branches },
  get gitFound() { return gitFound },
  get requireModel() { return requireModel },
  get resumeIn() { return resumeIn },
  get resumeWith() { return resumeWith },
  get retryAfterLimit() { return retryAfterLimit },
  get rulesClashes() { return rulesClashes },
  get rulesOf() { return rulesOf },
  get runtimes() { return runtimes },
  get sameRepositoryOf() { return sameRepositoryOf },
  get saveAccounts() { return saveAccounts },
  get savedLimits() { return savedLimits },
  get sayBlankedSecrets() { return sayBlankedSecrets },
  get secrets() { return secrets },
  get secretsSaid() { return secretsSaid },
  get server() { return server },
  set server(value: typeof server) { server = value },
  get sessionAccount() { return sessionAccount },
  get sessions() { return machineHost.sessions },
  set sessions(value: MachineHost['sessions']) { machineHost.sessions = value },
  get settingsFor() { return machine.settingsFor },
  get slotSpan() { return slotSpan },
  get slotUse() { return slotUse },
  get slotsSeen() { return machine.slotsSeen },
  get spendsByKey() { return spendsByKey },
  get startedAt() { return startedAt },
  get stateDb() { return stateDb },
  get statusMover() { return statusMover },
  get stateDir() { return stateDir },
  get stats() { return stats },
  get steering() { return steering },
  get stopIn() { return stopIn },
  get stopLingering() { return stopLingering },
  get stopTaskSessions() { return stopTaskSessions },
  get syncProject() { return syncProject },
  get tally() { return tally },
  set tally(value: typeof tally) { tally = value },
  get tallyMode() { return tallyMode },
  get tallyRestarts() { return tallyRestarts },
  set tallyRestarts(value: typeof tallyRestarts) { tallyRestarts = value },
  get tallyRuns() { return tallyRuns },
  set tallyRuns(value: typeof tallyRuns) { tallyRuns = value },
  get taskNote() { return taskNote },
  get taskRun() { return taskRun },
  get taskSource() { return taskSource },
  get tasksByProject() { return tasksByProject },
  get parentsByProject() { return parentsByProject },
  get token() { return token },
  set token(value: typeof token) { token = value },
  get trackerPlace() { return trackerPlace },
  get trackers() { return trackers },
  get transcriptWatch() { return transcriptWatch },
  get updater() { return updater },
  get updates() { return updates },
  get vacateSlot() { return vacateSlot },
  get vocabularies() { return vocabularies },
  get profileStatuses() { return profileStatuses },
  get vscode() { return vscode },
  get warmable() { return warmable },
  get wedgedSessions() { return wedgedSessions },
  get withProject() { return machine.withProject },
  get withSource() { return withSource },
  get works() { return works },
  get writes() { return writes },
}
/** The running service, for the chain's end-to-end tests (`src/e2e/`). */
export const service = context

const stateDb = keptDatabase()
const db = stateDb.db
const attachmentsDir = attachmentsDirOf(stateDirOf())
attachBuiltin(db, attachmentsDir)
const sweepFiles = () => void sweepAttachments(new BuiltinStore(db), attachmentsDir)
sweepFiles()
/** The database's writes are not waited for: the dispatcher and the page go on from what they hold in memory. */
const writes = new Writes((line) => console.warn(line))
/** What happened while nobody looked (BTN-350): the page's toasts and its /log come from it. */
const eventLog = await hubBootstrap.assembleEventLog(context)
const configStore = await hostingService.wireConfigStore(context)
eventLog.settingsSeen(configStore.raw())
const backups = hubBootstrap.assembleBackups(context)
const backupAtStart = takeStartFailure()
if (backupAtStart !== null) backups.failedAtStart(backupAtStart)
// The service names a project by its id (BTN-271): its log shows the project's label (`projectLabel`) instead.
for (const method of ['log', 'warn', 'error'] as const) {
  const write = console[method].bind(console)
  console[method] = (...args: unknown[]) => write(...args.map((arg) => (typeof arg === 'string' ? withLabels(arg, projectLabels(configStore.current)) : arg)))
}
/** The version whose toast the user closed: state, not a setting (BTN-199). */
let dismissedUpdate = (await stateValue(db, 'updates.dismissed')) as string | null | undefined
/** The page's "Got it" marks (BTN-759): state, not a setting. */
let dismissedNotices = ((await stateValue(db, 'notices.dismissed')) as Record<string, string> | undefined) ?? {}
/** The page's hotkeys of each browser (BTN-880), held in memory and written behind. */
let browserHotkeys = await loadBrowserHotkeys(db)
const intakeEntries = ((await stateValue(db, 'intake')) as IntakeEntry[] | undefined) ?? []
/** By project, the issue templates that put its intake label on (BTN-1130); filled by the intake's ticks. */
const intakeTemplateHits: Record<string, TemplateHit[]> = {}
/** The machine's own database (`docs/machines.md`, "The machine's stores"): closed by the machine link. */
const machineDb = await openMachineDatabase(join(stateDirOf(), MACHINE_DIR))
if (await importMachineStores(machineDb, db, new Date())) console.log('machine: the account limits, account settings and CLI copies moved into the machine database')
/** The tasks the merge closer closed and the commits main had of their branches then (BTN-689). */
const mergeMarks = new MergeMarks(await loadMergeMarks(db), (mark) => writes.add(`the close of ${mark.task}`, saveMergeMark(db, mark)))
/** The merged pull requests' tasks whose close the tracker refused, retried by the merge closers (BTN-1163). */
const pendingCloses = new PendingCloses()
/** What each task's sessions run on, set on its card (BTN-983), and the projects whose run labels are still to be moved. */
const taskRuns = await hubBootstrap.assembleTaskRuns(context)
/** The `rare:` lines already written and the pairs still open (BTN-814); unreadable rows only risk a repeated line. */
rareEvents.restore(await loadRareEvents(db).catch((error: unknown) => {
  console.warn(`storage: the rare events not read: ${error instanceof Error ? error.message : String(error)}`)
  return []
}), {
  save: (record) => writes.add(`the rare event ${record.entry}`, saveRareEvent(db, record)),
  prune: (before) => writes.add('the old rare events', pruneRareEvents(db, before)),
})
const envFile = loadEnv()
/** What a profile is made for: the trackers, Forgejo's among them, which serves its CI too (BTN-201, BTN-476). */
const profileKindsOf = profileKinds(ADAPTERS)
/**
 * The trackers' and Forgejo's credentials (BTN-200, BTN-201); the first start makes them of the variables of `.env`.
 * Forgejo's are `importForgejo`'s: `FORGEJO_TOKEN` alone is the CI's older form and makes a profile per remote host.
 */
const { forgejo: _forgejo, ...importedAdapters } = ADAPTERS
const trackerProfiles = await hubBootstrap.assembleTrackerProfiles(context)
const importedProfiles = await hubBootstrap.assembleImportedProfiles(context)
let { listen, token, mcpPort } = (() => {
  try {
    const listen = listenOf(process.env)
    return { listen, token: guardToken(process.env, listen.host), mcpPort: mcpPortOf(process.env) }
  } catch (error) {
    console.error(englishOf(noticeOf(error)))
    process.exit(1)
  }
})()
/** A new address that could not be taken: the service stays on the old one. */
let listenError: Notice | null = null
const branchOf = (project: string) => configStore.current.settings[project]?.branch ?? DEFAULT_BRANCH
const pullRequestsOn = (project: string) => configStore.current.settings[project]?.pullRequests ?? false
/** What the trackers read (BTN-66): every project, and every feed as a reader of its own id. */
const readers = () => readersOf(configStore.current)
/** The project a reader serves. */
const ownerOfReader = (reader: string) => ownerOf(readers(), reader)
/** The reader of a project's task: the feed whose ids the task's id carries, else the project. */
const readerFor = hubBootstrap.assembleReaderFor(context)
const feedOf = hubBootstrap.assembleFeedOf(context)
/** The projects and feeds whose tracker and profile stay: the chain has started a task of theirs. */
const lockedReaders = () => launchedProjects(launches, readerFor)
/** The readers whose profile's rules clash with their project's own, by the text logged: logged once while it lasts. */
const rulesClashes = new Map<string, string>()
/**
 * The reader's rules with its tracker profile's between the shared and its project's own (BTN-66). A clash the
 * profile's save did not catch (a project's own rules changed since) leaves the profile's out, with a line in the log.
 */
const readerRules = trackersService.wireReaderRules(context)
/** The project's rules; with a task, those of the feed it comes from. */
const rulesOf = hubBootstrap.assembleRulesOf(context)
const readerMoves = trackersService.wireReaderMoves(context)
const statusMover = trackersService.wireStatusMover(context)
const stateDir = stateDirOf()
mkdirSync(stateDir, { recursive: true })
const links = new Map<string, TrackerLink>()
/** The link of the reader's tracker — a project's, a feed's; `undefined` while that tracker is off. */
const linkOf = hubBootstrap.assembleLinkOf(context)
/** The link of the tracker a project's task is in. */
const linkFor = hubBootstrap.assembleLinkFor(context)
/** Reads the project's tasks anew from every tracker it reads; `false` — none reads it. */
const refreshProject = hubBootstrap.assembleRefreshProject(context)
const vocabularies = hubBootstrap.assembleVocabularies(context)
/** The statuses of each tracker profile (BTN-554), for its status moves. */
const profileStatuses = hubBootstrap.assembleProfileStatuses(context)
// The state goes to the page whole once, then by its changed parts, the sessions one by one (BTN-695); a tracker's
// last read moves only its own entry (BTN-1256).
const hub = new EventHub({ state: { sessions: 'sessionId', eventLog: 'id', trackers: 'name' } })
// The event log looks at the state also while no page listens, at most every two seconds (BTN-350).
hub.watch('state', (state) => eventLog.observe(state as EvenKeelState), 2_000)
/**
 * Sends the page the new state soon. Handlers wired above `getState`'s declaration may fire while this module still
 * starts — the Huly client's install does at once (EKR-52) — so a change before it waits for `ready` below (BTN-1285).
 */
const stateBroadcast = readyBroadcast(hub, 'state')
const stateChanged = stateBroadcast.changed
let machineLinked: LinkedMachine | undefined
/**
 * Something of the own machine the page shows changed (accounts, limits, a CLI): the machine posts it to the hub's mirror,
 * which the page reads. A change before the link is built goes with the first snapshot.
 */
const machineChanged = (): void => {
  void machineLinked?.port.catchUp?.()
  stateChanged()
}
/**
 * The own machine's assembly (`docs/machines.md`, "The machine's context"): this host's objects, and of the hub only
 * what its brief hands over. What it tells the hub goes over the link, connected once the link is built.
 */
const machineTell = laterTell()
let demo!: ReturnType<typeof demoService.wireDemo>
const { host: machineHost, machine } = await assembleMachineHost({
  machineDb,
  stateDir,
  writes,
  env: process.env,
  envFile,
  listen: () => listen,
  mcpPort: () => mcpPort,
  tell: machineTell,
  /** The demo on the first run (BTN-776): its account folder is listed from here on, before anything reads the folders. */
  homesOpened: (homes) => void (demo = demoService.wireDemo(context, homes)),
})
const {
  keyOrganizations, managementKeys, savedLimits, mailbox, limitsFile, accountFile, transcriptWatch, homes, accountSettings, claudeConfigs,
  packages, approvals, runtimes, agentOf, envOf, models, requireModel, secretsSaid, sayBlankedSecrets, cliLease, launchIn, resumeIn, stopIn,
  lingering, journal, gitFound, saveAccounts, homeOf, reach, keySpend, online, spendsByKey, limitRetries, retryAfterLimit, limits,
  cliVersions, cliChecks, daemons, cliCopies, chatTitles, vscode, account, owners, emailAt, sessionAccount, accountNow, contextWindows,
  monitor, wedgedSessions, logStartupDialogs, liveView, agentStatus, hasAccount, places, warmable, keepWarm, works, inHomes, stopLingering,
} = machineHost
/** The shared pool's Claude entry: whose `.claude.json` and tools the Claude-only checks read. */
const claudeAccount = () => machine.configStore.current.accounts[CLAUDE]!
/** The hub's project memory folders mirrored into the records chain sessions read and write (BTN-1029). */
const memory = accountsService.wireMemory(context)
const packageHub = accountsService.wirePackageHub(context)
/**
 * Whether the project's prompts carry its task: its own `brief`, else on exactly when no package brings the tracker's
 * MCP server (BTN-225). A feed's task (`reader`, BTN-66) is judged by the feed's tracker: `brief: false` speaks of the
 * project's own tracker's server only, and a server signed in as another profile than the feed's does not see its task.
 */
function briefOn(project: string, reader = project): boolean { return accountsService.briefOn(context, project, reader) }
const checkReports = new CheckReports()
const startedAt = new Date().toISOString()
const tasksByProject = new Map<string, Task[]>()
const parentsByProject = new Map<string, ParentTask[]>()
const refreshers = new Map<string, () => Promise<void>>()
const launches: LaunchEntry[] = await readLaunches(db)
/** The tasks the chain ran and saw closed, in memory as the database keeps them. */
const archive: ClosedTask[] = await closedTasks(db)
/** The trackers read by reader; the chain and the page get each project's readers as one (BTN-66). */
const readerTasks = trackersService.wireReaderTasks(context)
const trackers = trackersService.wireTrackers(context)
/**
 * The remote's CI token from the project's explicit choice or the automatic profile of its forge and host.
 */
const ciTokenOf = hubBootstrap.assembleCiTokenOf(context)
const protectionAudit = hubBootstrap.assembleProtectionAudit(context)
/** The remotes whose CI takes the profile's token, shown or not. */
const ciOn = hubBootstrap.assembleCiOn(context)
const pullRefusals = new PullRefusals()
const remotes = new ProjectRemotes(runGit)
const ciWatches = chainService.wireCiWatches(context)
/** The setting; an installation from before it that has not chosen keeps what Tally already ran on (BTN-247). */
const tallyMode = hubBootstrap.assembleTallyMode(context)
const newTally = statsService.wireNewTally(context)
let tally = newTally()
/** What `tally` runs on (`tallyKey`), and the restarts in turn: the page and `.env` may change it at once. */
let tallyRuns = tallyKey(tallyMode(), process.env)
let tallyRestarts = Promise.resolve()
/** The project's pinned checkpoint threshold, its own over the shared one; `null` — calibrated. */
const pinnedCheckpoint = hubBootstrap.assemblePinnedCheckpoint(context)
// Tally knows a project by its key: projects that share one are one project of the stats, on the first one's repository.
const stats = statsService.wireStats(context)

const release = installed(root)
const updates = accountsService.wireUpdates(context)
const releasesView = () => updatesView(release.version, updates.releases, { ...configStore.current.updates, dismissed: dismissedUpdate ?? null })
const updater = accountsService.wireUpdater(context)
const secrets = accountsService.wireSecrets(context)

const profiles: Profiles = accountsService.wireProfiles(context)
hulyClient.changed = stateChanged
gitSetup.changed = stateChanged
stepJobs.changed = stateChanged
// The folders of projects without git are checked once git's own read tells whether it starts (BTN-1025).
void gitSetup.check().catch((error: unknown) => console.error(`git: could not read its version and identity: ${englishOf(noticeOf(error))}`)).then(() => gitFound.checkAll())
installForProfiles(profiles.current().profiles)
/** The tracker refused the credentials of the profile the project runs on: its chain waits (BTN-200). */
const profileBlock = accountsService.wireProfileBlock(context)
/** Whether pull requests of the project in PR mode have where to go, by the remotes given (EKR-12). */
const pullReadinessOf = (project: string, urls: Remote[]) => pullReadiness(project, urls, (target) => ciTokenOf(project, target)?.token ?? null, gitlabUrls(profiles.current().profiles))
/**
 * PR mode with nowhere to open pull requests: no session of the project starts (EKR-12). The remotes are those
 * reread each minute, so one added by hand lifts it without a restart; a project not read yet is not held.
 */
const pullBlock = accountsService.wirePullBlock(context)

/** Whether a message goes into the live session mid-turn without its mailbox (`AgentEntry.steers`, BTN-291). */
const steering = accountsService.wireSteering(machine)

const knownTask = hubBootstrap.assembleKnownTask(context)
/** The first look at a project that read run labels before BTN-983 moves them into runs, once its tasks are listed. */
const moveRunLabels = hubBootstrap.assembleMoveRunLabels(context)
const runOfTask = hubBootstrap.assembleRunOfTask(context)
const runsOfProject = hubBootstrap.assembleRunsOfProject(context)
/** The page's card and the tasks server set a run; a live session keeps what it started on. */
const setTaskRun = hubBootstrap.assembleSetTaskRun(context)

/** What a new session of the task (or of the fix session `task`) runs on, and in which account folder. */
const choiceFor = accountsService.wireChoiceFor(context)

const noAccountFor = accountsService.wireNoAccountFor()

/** A draft is written in the project's main checkout, on the account and model a new session of its chain would get. */
const changelogs = chainService.wireChangelogs(context)
await changelogs.load()

/** The account holding the Even Keel role, the one the header shows: the shared provider's entry of the shared pool. */
const activeAccount = () => configStore.current.accounts[configStore.current.provider]!

/** The project's own, else the shared one. */
const promptLanguage = (project?: string) => (project === undefined ? undefined : configStore.current.settings[project]?.promptLanguage) ?? configStore.current.promptLanguage

/** Where in its tracker a reader's tasks are — a project's, a feed's. */
const trackerPlace = hubBootstrap.assembleTrackerPlace(context)
const briefed = chainService.wireBriefed(context)

function projectOf(task: string): string | undefined { return chainService.projectOf(context, task) }

/** How many slots the project's tasks may be in: the most it had since the start, so a pool shrunk on the fly still finds its busy slots. */
function slotSpan(project: string): number { return chainService.slotSpan(machine, project) }

/** Keeps a done task the chain ran in the database's archive, by what its tracker last said of it. */
function archiveClosed(project: string, task: string): void { return chainService.archiveClosed(context, project, task) }

/** The launch with where its task is read from (BTN-66); a fix or carry session has no tracker task. */
function withSource(entry: LaunchEntry): LaunchEntry { return chainService.withSource(context, entry) }

/** Where a project's task is read from (BTN-66): its tracker, the profile it runs on and its link. */
function taskSource(project: string, task: string): { tracker: string; profile: string | null; url: string | null } { return chainService.taskSource(context, project, task) }

/** A run of the project's commands for `task` (the project itself for `afterGreen`), in the environment of the account its sessions run on. */
function taskRun(task: string, cwd: string, account: string): SetupRun { return chainService.taskRun(machine, task, cwd, account) }

/** Syncs the project's main with its remotes the way the cleanup after Done does. */
function syncProject(project: string): Promise<Notice | null> { return chainService.syncProject(machine, project) }

const machineLink = await wireLinkedMachine(context, machine)
machineLinked = machineLink
const dispatcher = await chainService.wireDispatcher(context, machineLink.port)
await machineLink.start()
// The project chats (BTN-1230): their sessions are found again by name after a restart, like the chain's.
const projectChats = await wireProjectChats(context)
setInterval(() => void projectChats.sweep().catch((error: unknown) => console.warn(`chats: the sweep failed: ${(error as Error).message}`)), CHATS_SWEEP_MS).unref()

/** Whether the checkouts of two projects are of one repository (BTN-285); `undefined` until both are read. */
function sameRepositoryOf(a: string, b: string): boolean | undefined { return chainService.sameRepositoryOf(context, a, b) }

/**
 * A release project merges into a project of its own repository, read from both folders now: `parseConfig` has no git,
 * so a hand-made `config-import` is caught only by the carry, before it fetches anything.
 */
function checkMergeTarget(project: string, form: ProjectForm): Promise<void> { return chainService.checkMergeTarget(context, project, form) }
const forwards = chainService.wireForwards(context)

/**
 * Settles the tool call the session's permission hook holds (BTN-269); otherwise goes on in the live session with
 * `prompt` where its agent can (an SDK session, BTN-239); otherwise stops the session and resumes it, and the page
 * keeps it working, not finished, while it is respawned.
 */
function resumeWith(task: string, session: HandoffSession, prompt: string): Promise<string> { return chainService.resumeWith(machine, task, session, prompt) }

/** The words that came with an allowed call wait in the session's mailbox: it goes on with its turn at once. */
function approved(task: string, session: HandoffSession, prompt: string): boolean { return chainService.approved(machine, task, session, prompt) }
function goOnWith(home: AccountHome, task: string, session: HandoffSession, prompt: string): Promise<SessionStart> { return chainService.goOnWith(machine, home, task, session, prompt) }

/** Puts a chat message into a working session that steers (BTN-291); `false` — it is not live here after all. */
function steer(task: string, session: HandoffSession, prompt: string): Promise<boolean> { return chainService.steer(machine, task, session, prompt) }

const { mailRelay, answerSession } = createChat({
  dispatcher,
  catchUp: async () => machineLink.port.catchUp?.(),
  mailbox,
  configuredProject,
  liveView: (task) => machineLink.page.liveView(task),
  sessions: () => machineLink.page.sessions(),
  midTurn: (task) => machineLink.port.midTurn(task),
  steering: (sessionId) => machineLink.page.steers(sessionId),
  chat: machineLink.services.chat,
  listens: (sessionId) => machineLink.page.mailbox()[sessionId]?.listens === true,
  steer,
  language: promptLanguage,
  note: taskNote,
  changed: stateChanged,
  log: (line) => console.log(line),
  now: () => new Date(),
})
function occupantsOf(slot: string, task: string): { idle: import("./sessions/occupants.js").Occupant[]; busy: import("./sessions/occupants.js").Occupant[]; } { return chainService.occupantsOf(machine, slot, task) }
function slotUse(slot: string, task: string): SlotUse { return chainService.slotUse(machine, slot, task) }
function vacateSlot(slot: string, task: string, shared = false): Promise<void> { return chainService.vacateSlot(machine, slot, task, shared) }
function stopTaskSessions(project: string, repo: string, task: string, count: number, shared = false): ReturnType<typeof chainService.stopTaskSessions> { return chainService.stopTaskSessions(machine, project, repo, task, count, shared) }

/** What holds a project the page asks to remove: its chain, live sessions of its tasks or in its folders, the places it keeps. */
function removalFacts(project: string, repo: string): RemovalFacts { return chainService.removalFacts(context, project, repo) }

/** The project's main branch and its main checkout as one (BTN-754). */
const branches = chainService.wireBranches(context)

const getState = hostingService.wireGetState(context)

// The README badge (BTN-915): pushed on a state change, and on a timer for its delayed change and its pulse.
const badges = hubBootstrap.assembleBadges(context)
hub.watch('state', () => void badges.tick(), 2_000)
setInterval(() => void badges.tick(), 30_000).unref()
// The state's watchers are all wired: a change reported during the start goes now (BTN-1285).
stateBroadcast.ready(() => getState())

// The chain's switches are Even Keel's setting rows: the page's switches write them, and `onChange` hands them to the dispatcher.
const SWITCHES: Partial<Record<keyof ChainControl, (on: boolean) => void>> = hubBootstrap.assembleSWITCHES(context)
// The chain's start reads the checkout, so its card warns of a moved folder before a task's launch refuses (BTN-754).
const startChain = hubBootstrap.assembleStartChain(context)
const chainControl: ChainControl = hubBootstrap.assembleChainControl(context)

let server = hostingService.wireServer(context)

/**
 * The project of a task: the one whose list has it, else one whose task ids its id carries — projects on one tracker
 * project, or on one Linear team, share a prefix that is not their key (BTN-172); a feed's ids name its project (BTN-66).
 */
function configuredProject(task: string): string | undefined { return trackersService.configuredProject(context, task) }

/**
 * The handoff note a session of the task writes: through the tasks server when its project has it (BTN-1046), else a
 * file, one of its own in a project without git, whose folder is shared (BTN-964).
 */
function taskNote(task: string): string {
  const project = configuredProject(task)
  const kept = project !== undefined && packages.bringsServer(project, TASKS_SERVER)
  return handoffNoteOf(task, project === undefined || !isPlain(configStore.current, project), kept)
}

const postedQuestions = await loadQuestions(db)
const questions = trackersService.wireQuestions(context)

/** A project with `intakeLabel` on a tracker other than GitHub takes in the issues of its first github.com remote, on the token its CI takes. */
const intakePlaces = trackersService.wireIntakePlaces(context)
const intake = trackersService.wireIntake(context)

const applyCi = hubBootstrap.assembleApplyCi(context)
startTicks(context, machine, sweepFiles, () => void questions.tick(), () => void intake.tick())
/**
 * The config's projects changed: removed ones let their chain go, the rest follows the config. The state names a
 * project by its id (BTN-271), so a renamed key carries nothing.
 */
function projectsChanged(before: EvenKeelConfig): void { return trackersService.projectsChanged(context, before) }

// The accounts' own transports of schema v11 become `execution.claude` before the first launch (BTN-353), a folder gone
// or no Claude one left out; the file drops them once the setting is written.
lifecycleService.start(context)

/** `.env` changed: whoever reads the changed variables takes them now (`docs/service.md`). */
function envChanged(changed: string[]): Promise<void> { return statsService.envChanged(context, changed) }

/** Tally's mode or its database changed: the collector and the reader start anew on them; nothing when neither did. */
function applyTally(): Promise<void> { return statsService.applyTally(context) }

/** The token as the environment has it now; a wrong one keeps the last good token and says why. */
function applyGuard(): void { return hostingService.applyGuard(context) }

/** Moves the page to the address the environment has now: the new server first, the old one closes only once it listens. */
function rebind(): Promise<void> { return hostingService.rebind(context) }

