import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { type AccountHome } from './account/homes.js'
import { openAccountHomes } from './account/globals.js'
import { loadLedger, saveLedger, type AccountLedger } from './account/ledger.js'
import { loadKeyOrganizations } from './account/organizations.js'
import { providerUrl } from './account/network.js'
import type { SessionStart } from './agent/contract.js'
import { copies } from './agent/copies.js'
import { CLAUDE } from './claude/name.js'
import { type LaunchEntry } from './chain/dispatcher.js'
import { launchedProjects } from './chain/launches.js'
import { type HandoffSession, type TrackerPlace } from './chain/relay.js'
import { pullReadiness } from './review/open.js'
import { PullRefusals } from './review/refusals.js'
import { closedTasks, loadQuestions, readLaunches, type ClosedTask } from './chain/store.js'
import { ciToken, gitlabUrls, projectTargets } from './ci/adapters.js'
import { ProtectionAudit } from './ci/protection-audit.js'
import { FORGEJO_PROFILE } from './ci/forgejo-profile.js'
import { type CiTarget, type Remote } from './ci/remote.js'
import type { IntakeEntry } from './intake/model.js'
import { DEFAULT_BRANCH, listenOf, mcpPortOf, ownerOf, projectLabel, projectLabels, readerIds, readerOf, readersOf, type EvenKeelConfig } from './config.js'
import { EventHub } from './events.js'
import { runGit } from './git/run.js'
import { type SlotUse } from './git/slot.js'
import { limitRecovery } from './limits/recovery.js'
import { englishOf, fail, noticeOf, withLabels, type Notice } from './notice/notice.js'
import { guardToken } from './guard.js'
import { type RemovalFacts } from './projects/removal.js'
import { ProjectRemotes } from './projects/remotes.js'
import { Packages } from './packages/service.js'
import { type ChainControl } from './server.js'
import { Approvals } from './sessions/approvals.js'
import { createChat } from './sessions/chat.js'
import { Mailbox } from './sessions/mailbox.js'
import { settleMail } from './sessions/mailRelay.js'
import { type AgentEntry } from './sessions/agents.js'
import { type SetupRun } from './sessions/setup.js'
import { KEEP_WARM_TICK_MS, KeepWarm, type WarmTask } from './sessions/keepwarm.js'
import { ChatTitles } from './sessions/title.js'
import { TranscriptWatch } from './sessions/watch.js'
import { loadEnv, root, source, stateDirOf } from './locations.js'
import { profileKinds } from './profiles/model.js'
import { Profiles } from './profiles/service.js'
import { importForgejo, importProfiles } from './profiles/store.js'
import type { ProjectForm, SessionView } from './state.js'
import { Writes } from './storage/database.js'
import { keptDatabase } from './storage/owner.js'
import { stateValue } from './storage/service-state.js'
import { inferredTallyMode, tallyKey } from './stats/mode.js'
import { createSessionSettings } from './tools/sessionSettings.js'
import { ADAPTERS } from './tracker/adapters.js'
import type { TrackerLink } from './tracker/link.js'
import { type Task } from './tracker/model.js'
import { Vocabularies } from './tracker/vocabulary.js'
import { updatesView } from './updates/release.js'
import { installed } from './updates/watcher.js'
import * as accountsService from './service/accounts.js'
import * as chainService from './service/chain.js'
import * as hostingService from './service/hosting.js'
import * as statsService from './service/stats.js'
import * as trackersService from './service/trackers.js'
import * as lifecycleService from './service/lifecycle.js'
import * as cliCheckService from './service/cli-check.js'
import { AccountLease } from './cli-check/lease.js'
import type { CheckHistory } from './cli-check/scheduler.js'

const SESSION_POLL_MS = 3_000
/** How often the CLI and the account's settings are looked at for a context window that may have changed. */
const WINDOW_RECHECK_MS = 60_000
const AGENT_TIMEOUT_MS = 30_000
const CHANGELOG_TIMEOUT_MS = 10 * 60_000
const LIMITS_POLL_MS = 2_000
const USAGE_POLL_MS = 5 * 60_000
const OFFLINE_RETRY_MS = 30_000
const NETWORK_PROBE_MS = 5_000
const LAUNCH_CHART_DAYS = 14
const FALLBACK_TOAST_MS = 24 * 60 * 60_000
const ACCOUNT_POLL_MS = 60_000
/** How often a release project's branch is looked at for commits the branch it merges into lacks (BTN-172). */
const FORWARD_TICK_MS = 60_000
/** A project's task folders are read at most once per `WORK_TTL_MS`; the tick only lets a project read just now wait less. */
const WORK_TICK_MS = 15_000
const WORK_TTL_MS = 60_000
/** How often the labelled GitHub issues and the ones taken in are looked at (BTN-262). */
const INTAKE_TICK_MS = 2 * 60_000
const LIMIT_CHECK_MS = 30_000
const OWNERS_RESCAN_MS = 5 * 60_000
const CONFIG_POLL_MS = 2_000
const TRACKER_CHECK_MS = 15_000
const TALLY_INTERVAL_MS = 5 * 60_000
const TALLY_FIRST_DELAY_MS = 15_000
const SHUTDOWN_MS = 15_000
const CI_TICK_MS = 5_000
const CI_TARGETS_MS = 60_000
const CI_TIMEOUT_MS = 15_000
const UPDATE_POLL_MS = 12 * 60 * 60_000
const CLI_VERSION_POLL_MS = 15 * 60_000
const PLUGIN_UPDATE_TIMEOUT_MS = 2 * 60_000

export type ServiceContext = typeof context

/** Live bindings keep callbacks lazy across initialization and later state/config changes. */
const context = {
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
  get agentExtras() { return agentExtras },
  get agentOf() { return agentOf },
  get agentStatus() { return agentStatus },
  get agents() { return agents },
  set agents(value: typeof agents) { agents = value },
  get agentsRead() { return agentsRead },
  set agentsRead(value: typeof agentsRead) { agentsRead = value },
  get answerSession() { return answerSession },
  get applyCi() { return applyCi },
  get applyGuard() { return applyGuard },
  get applyTally() { return applyTally },
  get approvals() { return approvals },
  get approved() { return approved },
  get archive() { return archive },
  get archiveClosed() { return archiveClosed },
  get branchOf() { return branchOf },
  get briefOn() { return briefOn },
  get briefed() { return briefed },
  get chainControl() { return chainControl },
  get changelogs() { return changelogs },
  get chatTitles() { return chatTitles },
  get checkMergeTarget() { return checkMergeTarget },
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
  get dismissedUpdate() { return dismissedUpdate },
  set dismissedUpdate(value: typeof dismissedUpdate) { dismissedUpdate = value },
  get dispatcher() { return dispatcher },
  get emailAt() { return emailAt },
  get envChanged() { return envChanged },
  get envFile() { return envFile },
  get envOf() { return envOf },
  get feedOf() { return feedOf },
  get forwards() { return forwards },
  get getState() { return getState },
  get goOnWith() { return goOnWith },
  get hasAccount() { return hasAccount },
  get homeOf() { return homeOf },
  get homes() { return homes },
  get hub() { return hub },
  get importedProfiles() { return importedProfiles },
  get inHomes() { return inHomes },
  get intakeEntries() { return intakeEntries },
  get intakePlaces() { return intakePlaces },
  get keepWarm() { return keepWarm },
  get keyOrganizations() { return keyOrganizations },
  get knownTask() { return knownTask },
  get launchIn() { return launchIn },
  get launches() { return launches },
  get ledger() { return ledger },
  set ledger(value: typeof ledger) { ledger = value },
  get limitRetries() { return limitRetries },
  get limits() { return limits },
  get limitsFile() { return limitsFile },
  get linkFor() { return linkFor },
  get linkOf() { return linkOf },
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
  get mcpPort() { return mcpPort },
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
  get pinnedCheckpoint() { return pinnedCheckpoint },
  get places() { return places },
  get planFor() { return planFor },
  get postedQuestions() { return postedQuestions },
  get profileBlock() { return profileBlock },
  get profileKindsOf() { return profileKindsOf },
  get profiles() { return profiles },
  get projectOf() { return projectOf },
  get projectsChanged() { return projectsChanged },
  get promptLanguage() { return promptLanguage },
  get protectionAudit() { return protectionAudit },
  get pullBlock() { return pullBlock },
  get pullReadinessOf() { return pullReadinessOf },
  get pullRefusals() { return pullRefusals },
  get pullRequestsOn() { return pullRequestsOn },
  get readerFor() { return readerFor },
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
  get requireModel() { return requireModel },
  get resumeIn() { return resumeIn },
  get resumeWith() { return resumeWith },
  get retryAfterLimit() { return retryAfterLimit },
  get rulesClashes() { return rulesClashes },
  get rulesOf() { return rulesOf },
  get runtimes() { return runtimes },
  get sameRepositoryOf() { return sameRepositoryOf },
  get saveAccounts() { return saveAccounts },
  get sayBlankedSecrets() { return sayBlankedSecrets },
  get secrets() { return secrets },
  get secretsSaid() { return secretsSaid },
  get server() { return server },
  set server(value: typeof server) { server = value },
  get sessionAccount() { return sessionAccount },
  get sessions() { return sessions },
  set sessions(value: typeof sessions) { sessions = value },
  get settingsFor() { return settingsFor },
  get slotSpan() { return slotSpan },
  get slotUse() { return slotUse },
  get slotsSeen() { return slotsSeen },
  get spendsByKey() { return spendsByKey },
  get startedAt() { return startedAt },
  get stateDb() { return stateDb },
  get stateDir() { return stateDir },
  get stats() { return stats },
  get steering() { return steering },
  get stopIn() { return stopIn },
  get stopTaskSessions() { return stopTaskSessions },
  get syncProject() { return syncProject },
  get tally() { return tally },
  set tally(value: typeof tally) { tally = value },
  get tallyMode() { return tallyMode },
  get tallyRestarts() { return tallyRestarts },
  set tallyRestarts(value: typeof tallyRestarts) { tallyRestarts = value },
  get tallyRuns() { return tallyRuns },
  set tallyRuns(value: typeof tallyRuns) { tallyRuns = value },
  get taskRun() { return taskRun },
  get taskSource() { return taskSource },
  get tasksByProject() { return tasksByProject },
  get token() { return token },
  set token(value: typeof token) { token = value },
  get trackerPlace() { return trackerPlace },
  get trackers() { return trackers },
  get transcriptWatch() { return transcriptWatch },
  get updater() { return updater },
  get updates() { return updates },
  get vacateSlot() { return vacateSlot },
  get vocabularies() { return vocabularies },
  get vscode() { return vscode },
  get warmable() { return warmable },
  get wedgedSessions() { return wedgedSessions },
  get withProject() { return withProject },
  get withSource() { return withSource },
  get works() { return works },
  get writes() { return writes },
}
/** The running service, for the chain's end-to-end tests (`src/e2e/`). */
export const service = context

const stateDb = keptDatabase()
const db = stateDb.db
/** The database's writes are not waited for: the dispatcher and the page go on from what they hold in memory. */
const writes = new Writes((line) => console.warn(line))
const configStore = await hostingService.wireConfigStore(context)
// The service names a project by its id (BTN-271): its log shows the project's label (`projectLabel`) instead.
for (const method of ['log', 'warn', 'error'] as const) {
  const write = console[method].bind(console)
  console[method] = (...args: unknown[]) => write(...args.map((arg) => (typeof arg === 'string' ? withLabels(arg, projectLabels(configStore.current)) : arg)))
}
/** The version whose toast the user closed: state, not a setting (BTN-199). */
let dismissedUpdate = (await stateValue(db, 'updates.dismissed')) as string | null | undefined
const intakeEntries = ((await stateValue(db, 'intake')) as IntakeEntry[] | undefined) ?? []
/** The organization each API account's key pays through (BTN-418), held in memory and written behind. */
const keyOrganizations = await loadKeyOrganizations(db)
const envFile = loadEnv()
/** What a profile is made for: the trackers, then Forgejo's CI (BTN-201). */
const profileKindsOf = profileKinds(ADAPTERS, { forgejo: FORGEJO_PROFILE })
/** The trackers' and Forgejo's credentials (BTN-200, BTN-201); the first start makes them of the variables of `.env`. */
const trackerProfiles = await importProfiles({
  db,
  env: process.env,
  adapters: ADAPTERS,
  trackers: configStore.current.trackers,
  log: (line) => console.log(line),
})
const importedProfiles = await importForgejo({
  db,
  env: process.env,
  webs: async () => {
    const targets = await Promise.all(Object.values(configStore.current.projects).map((repo) => projectTargets(runGit, repo, trackerProfiles.profiles).catch(() => [])))
    return targets.flat().flatMap((target) => (target.kind === 'forgejo' ? [target.web] : []))
  },
  log: (line) => console.log(line),
})
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
const readerFor = (project: string, task: string) => readerOf(configStore.current, project, task)
const feedOf = (reader: string) => configStore.current.feeds[ownerOfReader(reader)]?.find((feed) => feed.id === reader)
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
const rulesOf = (project: string, task?: string) => readerRules(task === undefined ? project : readerFor(project, task))
const stateDir = stateDirOf()
mkdirSync(stateDir, { recursive: true })
const mailbox = await Mailbox.open(db, writes, () => new Date())
const limitsFile = join(stateDir, 'rate-limits.json')
const accountFile = join(stateDir, 'account.json')
const links = new Map<string, TrackerLink>()
/** The link of the reader's tracker — a project's, a feed's; `undefined` while that tracker is off. */
const linkOf = (reader: string): TrackerLink | undefined => {
  const key = trackers.keyOf(reader)
  return key === undefined ? undefined : links.get(key)
}
/** The link of the tracker a project's task is in. */
const linkFor = (project: string, task: string) => linkOf(readerFor(project, task))
/** Reads the project's tasks anew from every tracker it reads; `false` — none reads it. */
const refreshProject = async (project: string): Promise<boolean> => {
  const found = readerIds(configStore.current, project).flatMap((reader) => refreshers.get(reader) ?? [])
  await Promise.all(found.map((refresh) => refresh()))
  return found.length > 0
}
const vocabularies = new Vocabularies(async (project) => linkOf(project)?.run(async (tracker) => tracker.vocabulary?.(project)))
const hub = new EventHub()
const transcriptWatch = new TranscriptWatch(
  (sessionId) => hub.signal('transcript', { sessionId }),
  (error) => console.error(`sessions: watching a transcript: ${error instanceof Error ? error.message : String(error)}`),
)
const homes = await openAccountHomes(db, process.env)
/** The shared pool's Claude entry: whose `.claude.json` and tools the Claude-only checks read. */
const claudeAccount = () => configStore.current.accounts[CLAUDE]!
/** `.claude.json` files sessions read: the global one and that of a Claude account folder, the shared one by default. */
const claudeConfigs = (account = claudeAccount()) =>
  [...new Set([homes.global, homes.find(account)].flatMap((home) => (home === undefined ? [] : [homes.configFile(home)])))]
const packages: Packages = accountsService.wirePackages(context)
/**
 * Whether the project's prompts carry its task: its own `brief`, else on exactly when no package brings the tracker's
 * MCP server (BTN-225). A feed's task (`reader`, BTN-66) is judged by the feed's tracker: `brief: false` speaks of the
 * project's own tracker's server only, and a server signed in as another profile than the feed's does not see its task.
 */
function briefOn(project: string, reader = project): boolean { return accountsService.briefOn(context, project, reader) }
const approvals = new Approvals({ language: () => configStore.current.language ?? promptLanguage(), unattended: () => configStore.current.unattended })
const runtimes = accountsService.wireRuntimes(context)
/** The agent of an account folder: every session of the folder runs on it. */
const agentOf = accountsService.wireAgentOf(context)
const envOf = accountsService.wireEnvOf(context)
const models = accountsService.wireModels(context)
/** A model the account does not have is refused here, before the agent starts a turn that dies on it (BTN-336). */
const requireModel = accountsService.wireRequireModel(context)
const secretsSaid = new Map<string, string>()
/** Logs, once per account and list, the keys its `settings.json` sets that the chain's `--settings` blanks (BTN-436). */
const sayBlankedSecrets = accountsService.wireSayBlankedSecrets(context)
/** The account folders the automatic CLI check holds, and the chain launches it waits out (BTN-569). */
const cliLease = new AccountLease((home) => account.view.accounts.find((entry) => entry.key === home.key)?.name ?? home.key)
/** `project` — whose checkout a refusal of an untrusted folder names (BTN-429): its trust covers the task's worktree. */
const launchIn = accountsService.wireLaunchIn(context)
const resumeIn = accountsService.wireResumeIn(context)
const stopIn = accountsService.wireStopIn(context)
const startedAt = new Date().toISOString()
const tasksByProject = new Map<string, Task[]>()
const refreshers = new Map<string, () => Promise<void>>()
let sessions: SessionView[] = []
let agents: AgentEntry[] = []
let agentsRead = false
const launches: LaunchEntry[] = await readLaunches(db)
/** The tasks the chain ran and saw closed, in memory as the database keeps them. */
const archive: ClosedTask[] = await closedTasks(db)
/** The trackers read by reader; the chain and the page get each project's readers as one (BTN-66). */
const readerTasks = trackersService.wireReaderTasks(context)
const trackers = trackersService.wireTrackers(context)
/**
 * The remote's CI token from the project's explicit choice or the automatic profile of its forge and host.
 */
const ciTokenOf = (project: string, target: CiTarget) =>
  ciToken(target, profiles.current(), project, configStore.current.trackers[project]!, configStore.current.settings[project]?.remoteProfiles)
const protectionAudit = new ProtectionAudit({ config: () => configStore.current, git: runGit, token: (project, target) => ciTokenOf(project, target)?.token ?? null, gitlabUrls: () => gitlabUrls(profiles.current().profiles), changed: () => hub.broadcast('state', getState()) })
/** The remotes whose CI takes the profile's token, shown or not. */
const ciOn = (profileId: string, hidden: boolean) =>
  ciWatches
    .places(hidden)
    .filter(({ project, target }) => ciTokenOf(project, target)?.profile === profileId)
    .map(({ project, target }) => ({ project, remote: target.remote }))
const pullRefusals = new PullRefusals()
const remotes = new ProjectRemotes(runGit)
const ciWatches = chainService.wireCiWatches(context)
/** The setting; an installation from before it that has not chosen keeps what Tally already ran on (BTN-247). */
const tallyMode = () => configStore.current.tally ?? inferredTallyMode(process.env, existsSync(join(stateDir, 'tally', 'pgdata')))
const newTally = statsService.wireNewTally(context)
let tally = newTally()
/** What `tally` runs on (`tallyKey`), and the restarts in turn: the page and `.env` may change it at once. */
let tallyRuns = tallyKey(tallyMode(), process.env)
let tallyRestarts = Promise.resolve()
/** The project's pinned checkpoint threshold, its own over the shared one; `null` — calibrated. */
const pinnedCheckpoint = (project: string | undefined) =>
  project === undefined || configStore.current.settings[project] === undefined
    ? configStore.current.stats.checkpointTokens
    : configStore.current.settings[project].checkpointTokens
// Tally knows a project by its key: projects that share one are one project of the stats, on the first one's repository.
const stats = statsService.wireStats(context)
let ledger = loadLedger(accountFile)

const saveAccounts = (next: AccountLedger) => {
  ledger = next
  saveLedger(accountFile, ledger)
}

const homeOf = (key: string): AccountHome => {
  const home = homes.find(key)
  if (home === undefined) throw fail('account.homeGone', { key })
  return home
}

const reach = accountsService.wireReach(context)
const online = (home: AccountHome) => reach.up(providerUrl(home.agent))
const { spendsByKey, limitRetries, retryAfterLimit } = limitRecovery({
  homeOf: (key) => homes.find(key),
  agentOf,
  apiKey: (key) => account.apiKey(key),
  creditBackAfter: (key, at, text) => account.creditBackAfter(key, at, text),
  limits: (key) => limits.limits(key),
  usage: (key) => limits.usage(key),
})

const limits = accountsService.wireLimits(context)

const release = installed(root)
const updates = accountsService.wireUpdates(context)
const releasesView = () => updatesView(release.version, updates.releases, { ...configStore.current.updates, dismissed: dismissedUpdate ?? null })
const updater = accountsService.wireUpdater(context)

const cliVersions = accountsService.wireCliVersions(context)
const cliChecks = cliCheckService.wireCliChecks(context, ((await stateValue(db, 'cliCheck.history')) as CheckHistory | undefined) ?? {})

const daemons = accountsService.wireDaemons(context)

const cliCopies = copies(runtimes, (name, source) => configStore.saveCli(name, source),
  () => { dispatcher.check(); hub.broadcast('state', getState()); void account.refresh() },
  async () => { await cliVersions.check(); await account.refresh() })

const secrets = accountsService.wireSecrets(context)

const profiles: Profiles = accountsService.wireProfiles(context)
/** The tracker refused the credentials of the profile the project runs on: its chain waits (BTN-200). */
const profileBlock = accountsService.wireProfileBlock(context)
/** Whether pull requests of the project in PR mode have where to go, by the remotes given (EKR-12). */
const pullReadinessOf = (project: string, urls: Remote[]) => pullReadiness(project, urls, (target) => ciTokenOf(project, target)?.token ?? null, gitlabUrls(profiles.current().profiles))
/**
 * PR mode with nowhere to open pull requests: no session of the project starts (EKR-12). The remotes are those
 * reread each minute, so one added by hand lifts it without a restart; a project not read yet is not held.
 */
const pullBlock = accountsService.wirePullBlock(context)

const chatTitles = new ChatTitles()
const vscode = accountsService.wireVscode(context)

const account = accountsService.wireAccount(context)

const owners = accountsService.wireOwners(context)

/** The e-mail a folder had at `at` (the folder's account may change), else its current one. */
const emailAt = accountsService.wireEmailAt(context)

const sessionAccount = accountsService.wireSessionAccount(context)

/** The account folder `key` (the active one unless given) as the chain judges a launch in it. */
const accountNow = accountsService.wireAccountNow(context)

const contextWindows = accountsService.wireContextWindows(context)

const monitor = accountsService.wireMonitor(context)

const wedgedSessions = new Set<string>()

function logStartupDialogs(views: SessionView[]): void { return accountsService.logStartupDialogs(context, views) }

const liveView = accountsService.wireLiveView(context)

/** Whether a message goes into the live session mid-turn without its mailbox (`AgentEntry.steers`, BTN-291). */
const steering = accountsService.wireSteering(context)

/** A session just resumed is mid-turn until the daemon shows it working, which lags the resume by seconds (BTN-307). */
const agentStatus = accountsService.wireAgentStatus(context)

const knownTask = (task: string) => [...tasksByProject.values()].flat().find((each) => each.id === task)
/** A pool entry counts only while its folder exists and belongs to the provider it is filed under. */
const hasAccount = accountsService.wireHasAccount(context)

/** What a new session of the task (or of the fix session `task`) runs on, and in which account folder. */
const choiceFor = accountsService.wireChoiceFor(context)

const planFor = accountsService.wirePlanFor(context)

/** What a session also gets: the project's packages, and the global execution mode for an agent other than Claude Code. */
const agentExtras = accountsService.wireAgentExtras(context)

const noAccountFor = accountsService.wireNoAccountFor(context)

/** A draft is written in the project's main checkout, on the account and model a new session of its chain would get. */
const changelogs = chainService.wireChangelogs(context)
await changelogs.load()

/** The account holding the Even Keel role, the one the header shows: the shared provider's entry of the shared pool. */
const activeAccount = () => configStore.current.accounts[configStore.current.provider]!

/** The project's own, else the shared one. */
const promptLanguage = (project?: string) => (project === undefined ? undefined : configStore.current.settings[project]?.promptLanguage) ?? configStore.current.promptLanguage

/** Where in its tracker a reader's tasks are — a project's, a feed's. */
const trackerPlace = (reader: string): TrackerPlace | null => {
  const all = readers()
  const name = all.trackers[reader]!
  const place = all.trackerProjects[reader]
  return place === undefined ? null : { title: ADAPTERS[name]!.title, project: place }
}

const briefed = chainService.wireBriefed(context)

/** Even Keel's prompt and the project's own, for a new session only: a resumed one already has them. */
const withProject = chainService.wireWithProject(context)

const settingsFor = createSessionSettings({ config: () => configStore.current, packages, globalDir: homes.global.dir, trim: () => dispatcher.state.trimTools, projectOf })

function projectOf(task: string): string | undefined { return chainService.projectOf(context, task) }

const slotsSeen = new Map<string, number>()
/** How many slots the project's tasks may be in: the most it had since the start, so a pool shrunk on the fly still finds its busy slots. */
function slotSpan(project: string): number { return chainService.slotSpan(context, project) }

const places = chainService.wirePlaces(context)

/** Keeps a done task the chain ran in the database's archive, by what its tracker last said of it. */
function archiveClosed(project: string, task: string): void { return chainService.archiveClosed(context, project, task) }

/** The launch with where its task is read from (BTN-66); a fix or carry session has no tracker task. */
function withSource(entry: LaunchEntry): LaunchEntry { return chainService.withSource(context, entry) }

/** Where a project's task is read from (BTN-66): its tracker, the profile it runs on and its link. */
function taskSource(project: string, task: string): { tracker: string; profile: string | null; url: string | null } { return chainService.taskSource(context, project, task) }

/** A run of the project's commands for `task` (the project itself for `afterGreen`), in the environment of the account its sessions run on. */
function taskRun(task: string, cwd: string, account: string): SetupRun { return chainService.taskRun(context, task, cwd, account) }

/** Syncs the project's main with its remotes the way the cleanup after Done does. */
function syncProject(project: string): Promise<Notice | null> { return chainService.syncProject(context, project) }

/** The live view of the session a running chain will go on in, if its agent can ping a fork of it (BTN-437). */
const warmable = ({ task, sessionId }: WarmTask): SessionView | undefined => {
  const view = liveView(task)
  if (view === undefined || (sessionId !== null && view.sessionId !== sessionId)) return undefined
  const session = monitor.handoff(task)
  return session?.sessionId === view.sessionId && agentOf(homeOf(session.account)).warm !== undefined ? view : undefined
}

const keepWarm: KeepWarm = chainService.wireKeepWarm(context)

const dispatcher = await chainService.wireDispatcher(context)

/** Whether the checkouts of two projects are of one repository (BTN-285); `undefined` until both are read. */
function sameRepositoryOf(a: string, b: string): boolean | undefined { return chainService.sameRepositoryOf(context, a, b) }

/**
 * A release project merges into a project of its own repository, read from both folders now: `parseConfig` has no git,
 * so a hand-made `config-import` is caught only by the carry, before it fetches anything.
 */
function checkMergeTarget(project: string, form: ProjectForm): Promise<void> { return chainService.checkMergeTarget(context, project, form) }

const works = chainService.wireWorks(context)

const forwards = chainService.wireForwards(context)

/**
 * Settles the tool call the session's permission hook holds (BTN-269); otherwise goes on in the live session with
 * `prompt` where its agent can (an SDK session, BTN-239); otherwise stops the session and resumes it, and the page
 * keeps it working, not finished, while it is respawned.
 */
function resumeWith(task: string, session: HandoffSession, prompt: string): Promise<string> { return chainService.resumeWith(context, task, session, prompt) }

/** The words that came with an allowed call wait in the session's mailbox: it goes on with its turn at once. */
function approved(task: string, session: HandoffSession, prompt: string): boolean { return chainService.approved(context, task, session, prompt) }

function goOnWith(home: AccountHome, task: string, session: HandoffSession, prompt: string): SessionStart { return chainService.goOnWith(context, home, task, session, prompt) }

/** Puts a chat message into a working session that steers (BTN-291); `false` — it is not live here after all. */
function steer(task: string, session: HandoffSession, prompt: string): Promise<boolean> { return chainService.steer(context, task, session, prompt) }

const { mailRelay, answerSession } = createChat({
  dispatcher,
  mailbox,
  configuredProject,
  liveView,
  midTurn: (task) => agentStatus(task) === 'busy',
  steering,
  steer,
  language: promptLanguage,
  changed: () => hub.broadcast('state', getState()),
  log: (line) => console.log(line),
  now: () => new Date(),
})

function occupantsOf(slot: string, task: string): { idle: import("./sessions/occupants.js").Occupant[]; busy: import("./sessions/occupants.js").Occupant[]; } { return chainService.occupantsOf(context, slot, task) }

function slotUse(slot: string, task: string): SlotUse { return chainService.slotUse(context, slot, task) }

function vacateSlot(slot: string, task: string): Promise<void> { return chainService.vacateSlot(context, slot, task) }

function stopTaskSessions(repo: string, task: string, count: number): Promise<Notice[]> { return chainService.stopTaskSessions(context, repo, task, count) }

/** What holds a project the page asks to remove: its chain, live sessions of its tasks or in its folders, the places it keeps. */
function removalFacts(project: string, repo: string): RemovalFacts { return chainService.removalFacts(context, project, repo) }

const getState = hostingService.wireGetState(context)

// The chain's switches are Even Keel's setting rows: the page's switches write them, and `onChange` hands them to the dispatcher.
const SWITCHES: Partial<Record<keyof ChainControl, (on: boolean) => void>> = {
  setUnattended: (on) => configStore.saveChainSwitches({ unattended: on }),
  setTrimTools: (on) => configStore.saveChainSwitches({ trimTools: on }),
}
const chainControl: ChainControl = new Proxy(dispatcher, {
  get: (target, key, receiver) => SWITCHES[key as keyof ChainControl] ?? Reflect.get(target, key, receiver),
})

let server = hostingService.wireServer(context)

/** The first answer `read` finds in any account folder. */
async function inHomes<T>(read: (home: AccountHome) => Promise<T | undefined>): Promise<T | undefined> {
  for (const home of homes.list()) {
    const found = await read(home)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * The project of a task: the one whose list has it, else one whose task ids its id carries — projects on one tracker
 * project, or on one Linear team, share a prefix that is not their key (BTN-172); a feed's ids name its project (BTN-66).
 */
function configuredProject(task: string): string | undefined { return trackersService.configuredProject(context, task) }

const postedQuestions = await loadQuestions(db)
const questions = trackersService.wireQuestions(context)

/** A project with `intakeLabel` on a tracker other than GitHub takes in the issues of its first github.com remote, on the token its CI takes. */
const intakePlaces = trackersService.wireIntakePlaces(context)
const intake = trackersService.wireIntake(context)

setInterval(() => hub.broadcast('ping', { at: new Date().toISOString() }), 15_000).unref()
setInterval(() => void questions.tick(), 15_000).unref()
setInterval(() => settleMail(mailRelay), 15_000).unref()

setInterval(() => dispatcher.check(), LIMIT_CHECK_MS).unref()
setInterval(() => void keepWarm.check(), KEEP_WARM_TICK_MS).unref()
setInterval(() => void cliChecks.check(), cliCheckService.CLI_CHECK_TICK_MS).unref()
setInterval(() => void dispatcher.pollReviews().catch((error) => console.error(`review: the poll failed: ${englishOf(noticeOf(error))}`)), 60_000).unref()

const applyCi = () =>
  void Promise.all([ciWatches.apply(configStore.current.projects), remotes.apply(configStore.current.projects)]).then(() => {
    dispatcher.check()
    hub.broadcast('state', getState())
  })
applyCi()
setInterval(() => {
  for (const watch of ciWatches.all()) void watch.tick()
}, CI_TICK_MS).unref()
setInterval(() => void forwards.tick().catch(() => { }), FORWARD_TICK_MS).unref()
setInterval(() => void intake.tick(), INTAKE_TICK_MS).unref()
const pollWorks = () => {
  const projects = Object.keys(configStore.current.projects)
  works.keep(projects)
  for (const project of projects) if (tasksByProject.has(project)) void works.poll(project)
}
pollWorks()
setInterval(pollWorks, WORK_TICK_MS).unref()
setInterval(
  () =>
    void Promise.all([ciWatches.refresh(), remotes.apply(configStore.current.projects)]).then(([changed, moved]) => {
      if (changed || moved) dispatcher.check()
      if (changed || moved) hub.broadcast('state', getState())
    }),
  CI_TARGETS_MS,
).unref()

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

