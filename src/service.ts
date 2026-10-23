import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { checkCredit, checkOpenAiCredit, type CreditVerdict } from './account/credit.js'
import { DaemonRefresh } from './account/daemon.js'
import { AccountHomes, accountsRoot, codexAccountsRoot, copilotAccountsRoot, keyProvider, openCodeAccountsRoot, type AccountHome } from './account/homes.js'
import { checkApiKey, checkGitHubToken, checkOpenAiKey } from './account/keycheck.js'
import { accountAt, chooseTransport, forgetAccount, loadLedger, markRemoving, nameAccount, noteAccount, saveLedger, type AccountLedger } from './account/ledger.js'
import { transportOf } from './account/transport.js'
import { accountId, launchBlock, liveSessions, loginBlock, type LoginBlock } from './account/model.js'
import { answers, providerUrl, Reachability } from './account/network.js'
import { VsCodeAccount, vscodeSettingsFile } from './account/vscode.js'
import { AccountWatcher } from './account/watcher.js'
import { AGENTS } from './agent/adapters.js'
import type { Agent, SessionHandle, SessionStart } from './agent/contract.js'
import { sessionBase } from './agent/env.js'
import { ContextWindows } from './agent/windows.js'
import { outdatedDaemonView, VersionWatcher } from './agent/versions.js'
import { addMarketplace, updateMarketplace } from './claude/cli.js'
import { CLAUDE } from './claude/name.js'
import { Dispatcher, type LaunchEntry } from './chain/dispatcher.js'
import { fallbacksSince, fixEpisodes, handoffsOf, launchDays, launchedProjects, ranSince, taskSessions } from './chain/launches.js'
import { fixNameOf, fixStem, isFixName, projectOfFix } from './chain/fix.js'
import { chainQuiet, ForwardMerger } from './chain/forward.js'
import { fixPrompt, noteOf, resumePrompt, startPrompt, withBrief, withProjectPrompt, withTracker, withUnattended, type HandoffSession, type TrackerPlace } from './chain/relay.js'
import { launchLine } from './chain/log.js'
import { mainCheckDeps, mergeCheck } from './chain/mainci.js'
import { TaskPlaces } from './chain/places.js'
import { readNote, saveSnapshot, snapshotReason } from './chain/snapshots.js'
import { pullReadiness } from './review/open.js'
import { PullRefusals } from './review/refusals.js'
import { reviewDeps } from './review/wiring.js'
import { archivedShown } from './chain/archive.js'
import { appendLaunch, closedTasks, loadChainState, loadQuestions, readLaunches, saveChainState, saveClosedTask, saveQuestions, type ClosedTask } from './chain/store.js'
import { ChangelogDrafts } from './changelog/drafts.js'
import { DEFAULT_CHANGELOG } from './changelog/file.js'
import { changesOf } from './git/changes.js'
import { TaskWorks, worksOf } from './git/work.js'
import { commitChangelog } from './git/changelog.js'
import { ciSource, ciToken, projectTargets } from './ci/adapters.js'
import { FORGEJO_PROFILE } from './ci/forgejo-profile.js'
import { parseRemote, type CiTarget, type Remote } from './ci/remote.js'
import { intakeRepo } from './intake/github.js'
import { Intake, type IntakePlace } from './intake/intake.js'
import type { IntakeEntry } from './intake/model.js'
import { CiWatch } from './ci/watcher.js'
import { CiWatches } from './ci/watches.js'
import { ConfigStore } from './config-store.js'
import {
  DEFAULT_BRANCH,
  DEFAULT_CI,
  firstByKey,
  idPrefixOf,
  listenOf,
  mcpPortOf,
  mergeTargetOf,
  ownerOf,
  poolEntries,
  projectLabel,
  projectLabels,
  projectsByAccount,
  readerIds,
  readerOf,
  readersOf,
  readKeyOf,
  runSettings,
  type EvenKeelConfig,
} from './config.js'
import { envTargets } from './env-file.js'
import { EventHub } from './events.js'
import { runGit } from './git/run.js'
import { finishSlot, heldSlot, prepareSlot, slotPaths, type SlotUse } from './git/slot.js'
import { fastForwardMain, syncMain } from './git/sync.js'
import { ensureIgnored, finishWorktree, prepareWorktree, requireBranch, requireCheckedOut, taskPlace } from './git/worktree.js'
import { exhaustedReset, limitResetAfter } from './limits/model.js'
import { LimitsWatcher } from './limits/watcher.js'
import { englishOf, fail, notice, NoticeError, noticeOf, withLabels, type Notice } from './notice/notice.js'
import { guardHosts, guardToken } from './guard.js'
import { readJson } from './packages/plugins.js'
import { checkDraft } from './projects/check.js'
import { removalBlock, type RemovalFacts } from './projects/removal.js'
import { checkoutRemotes, ProjectRemotes, remotePeers, remotesIn, repositoryIds, sameRepository } from './projects/remotes.js'
import { Packages } from './packages/service.js'
import { secretCatalog } from './secrets/catalog.js'
import { Secrets } from './secrets/service.js'
import { createEvenKeelServer, type ChainControl } from './server.js'
import { Approvals } from './sessions/approvals.js'
import { replyParts, replyPrompt, type Reply } from './sessions/ask.js'
import { inboxImage, saveInbox, type InboxFile } from './sessions/inbox.js'
import { sharedFile } from './sessions/shareFile.js'
import type { SessionMail } from './sessions/mail.js'
import { Mailbox } from './sessions/mailbox.js'
import { mailFor, settleMail, type MailRelay } from './sessions/mailRelay.js'
import { isLive, turnStatus, type AgentEntry } from './sessions/agents.js'
import { launchPlan, runChoice, type LaunchPlan, type RunChoice } from './sessions/launch.js'
import { accountEnv, runAfterGreen, runBeforeStart, runCheck, systemShell, type SetupRun } from './sessions/setup.js'
import { SessionMonitor } from './sessions/monitor.js'
import { noteAtEnd } from './sessions/note.js'
import { TranscriptOwners } from './sessions/owners.js'
import { ChatTitles } from './sessions/title.js'
import { TranscriptWatch } from './sessions/watch.js'
import { configPath, home as dataHome, loadEnv, root, source, stateDirOf } from './locations.js'
import { isInside } from './paths.js'
import { defaultProfile, keyPool, profileFor, profileKinds, serverProfile } from './profiles/model.js'
import { checkProfileRules, projectRules } from './profiles/rules.js'
import { Profiles } from './profiles/service.js'
import { importForgejo, importProfiles } from './profiles/store.js'
import { slotOccupants } from './sessions/occupants.js'
import { locateWorktree } from './sessions/place.js'
import type { EvenKeelState, ProjectForm, SessionView } from './state.js'
import { withinWindow } from './stats/checkpoint.js'
import { StatsReader } from './stats/reader.js'
import { SQLITE_VERSIONS, STEPS as DATABASE_STEPS, Writes } from './storage/database.js'
import { keptDatabase } from './storage/owner.js'
import { SCHEMA_VERSION } from './storage/schema.js'
import { TALLY_SCHEMA_VERSION } from './stats/tally-schema.js'
import { setStateValue, stateValue } from './storage/service-state.js'
import { checkServer, serverValues } from './stats/connect.js'
import { inferredTallyMode, tallyKey } from './stats/mode.js'
import { TallyService } from './stats/tally.js'
import { chainSettings, readToolsView } from './tools/panel.js'
import { ADAPTERS, trackerKeyRules } from './tracker/adapters.js'
import { cardOf } from './tracker/card.js'
import type { TrackerLink } from './tracker/link.js'
import { issueLink, parseTaskId, runLabelText, type Task } from './tracker/model.js'
import { TrackerQuestions, type AskingSession } from './tracker/questions.js'
import { ReaderTasks } from './tracker/readers.js'
import { RAN_SHOWN_MS, startTracker } from './tracker/start.js'
import { Trackers } from './tracker/trackers.js'
import { Vocabularies } from './tracker/vocabulary.js'
import { updatesView } from './updates/release.js'
import { stateUrlOf, Updater } from './updates/updater.js'
import { installed, UpdateWatcher } from './updates/watcher.js'
import { firstRun } from './setup.js'

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
const KEY_CHECK_MS = 60 * 60_000
const KEY_CHECK_TIMEOUT_MS = 15_000
const CREDIT_CHECK_MS = 5 * 60_000
/** The key and credit checks by whose key it is (`keyProvider`); GitHub has no way to ask about a token's AI credits. */
const KEY_CHECKS = { anthropic: checkApiKey, openai: checkOpenAiKey, github: checkGitHubToken }
const CREDIT_CHECKS = {
  anthropic: checkCredit,
  openai: checkOpenAiCredit,
  github: async (): Promise<CreditVerdict> => ({ state: 'unknown', reason: 'GitHub does not tell the AI credits of a token' }),
}
const APP_POLL_MS = 5_000
const LOGIN_TIMEOUT_MS = 10 * 60_000
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

const stateDb = keptDatabase()
const db = stateDb.db
/** The database's writes are not waited for: the dispatcher and the page go on from what they hold in memory. */
const writes = new Writes((line) => console.warn(line))
const configStore = await ConfigStore.open({
  db,
  writes,
  intervalMs: CONFIG_POLL_MS,
  warn: (message) => console.warn(message),
  onChange: (before) => {
    if (before !== configStore.current) projectsChanged(before)
    dispatcher.setUnattended(configStore.current.unattended)
    dispatcher.setTrimTools(configStore.current.trimTools)
    for (const [project, tasks] of tasksByProject) dispatcher.setTasks(project, tasks)
    dispatcher.check()
    updates.configChanged()
    void applyTally()
    hub.broadcast('state', getState())
  },
})
// The service names a project by its id (BTN-271): its log shows the project's label (`projectLabel`) instead.
for (const method of ['log', 'warn', 'error'] as const) {
  const write = console[method].bind(console)
  console[method] = (...args: unknown[]) => write(...args.map((arg) => (typeof arg === 'string' ? withLabels(arg, projectLabels(configStore.current)) : arg)))
}
/** The version whose toast the user closed: state, not a setting (BTN-199). */
let dismissedUpdate = (await stateValue(db, 'updates.dismissed')) as string | null | undefined
const intakeEntries = ((await stateValue(db, 'intake')) as IntakeEntry[] | undefined) ?? []
const envFile = loadEnv()
/** What a profile is made for: the trackers, then Forgejo's CI (BTN-201). */
const profileKindsOf = profileKinds(ADAPTERS, { forgejo: FORGEJO_PROFILE })
/** The trackers' and Forgejo's credentials (BTN-200, BTN-201); the first start makes them of the variables of `.env`. */
await importProfiles({
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
    const targets = await Promise.all(Object.values(configStore.current.projects).map((repo) => projectTargets(runGit, repo).catch(() => [])))
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
const readerRules = (reader: string) => {
  const project = ownerOfReader(reader)
  try {
    const rules = projectRules(configStore.current, profiles.current(), project, feedOf(reader))
    rulesClashes.delete(reader)
    return rules
  } catch (error) {
    const text = englishOf(noticeOf(error))
    if (rulesClashes.get(reader) !== text) console.log(`rules: the tracker profile's rules are left out: ${text}`)
    rulesClashes.set(reader, text)
    return configStore.current.rules[project]!
  }
}
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
const homes = new AccountHomes(process.env, accountsRoot(process.env))
/** The shared pool's Claude entry: whose `.claude.json` and tools the Claude-only checks read. */
const claudeAccount = () => configStore.current.accounts[CLAUDE]!
/** `.claude.json` files sessions read: the global one and the shared Claude account's. */
const claudeConfigs = () =>
  [...new Set([homes.global, homes.find(claudeAccount())].flatMap((home) => (home === undefined ? [] : [homes.configFile(home)])))]
const packages: Packages = new Packages({
  file: join(stateDir, 'packages.json'),
  cache: join(stateDir, 'packages'),
  envFile: join(dataHome, '.env'),
  get repos() {
    return configStore.current.projects
  },
  globalDir: homes.global.dir,
  ownDir: root,
  claudeConfigs,
  rules: trackerKeyRules(),
  tracker: (project) => {
    const server = ADAPTERS[configStore.current.trackers[project]!]!.mcpServer
    return server === undefined ? undefined : { server, required: !briefOn(project) }
  },
  agentOf: (project) => homes.find(choiceFor(project).account)?.agent ?? CLAUDE,
  updateMarketplace: (marketplace) => updateMarketplace(envOf(homes.global), marketplace, PLUGIN_UPDATE_TIMEOUT_MS),
  addMarketplace: (dir) => addMarketplace(envOf(homes.global), dir, PLUGIN_UPDATE_TIMEOUT_MS),
  baseEnv: (): NodeJS.ProcessEnv => sessionBase(process.env, packages.keyNames()),
  poolOf: (project) => keyPool(profiles.current(), profileKindsOf, process.env, project, configStore.current.trackers[project]!, configStore.current.feeds[project]),
  port: mcpPort,
  log: (line) => console.log(line),
  onChange: () => {
    dispatcher.check()
    hub.broadcast('state', getState())
  },
})
/**
 * Whether the project's prompts carry its task: its own `brief`, else on exactly when no package brings the tracker's
 * MCP server (BTN-225). A feed's task (`reader`, BTN-66) is judged by the feed's tracker: `brief: false` speaks of the
 * project's own tracker's server only, and a server signed in as another profile than the feed's does not see its task.
 */
function briefOn(project: string, reader = project): boolean {
  const own = configStore.current.briefs[project]
  if (own === true || (own === false && reader === project)) return own
  const tracker = readers().trackers[reader]!
  const server = ADAPTERS[tracker]!.mcpServer
  if (server === undefined || !packages.bringsServer(project, server)) return true
  if (reader === project) return false
  const { trackers, feeds } = configStore.current
  const set = profiles.current()
  return serverProfile(set, project, trackers[project]!, feeds[project] ?? [], tracker)?.id !== profileFor(set, reader, tracker)?.id
}
const approvals = new Approvals({ language: () => configStore.current.language ?? promptLanguage(), unattended: () => configStore.current.unattended })
const runtimes = new Map<string, Agent>(
  Object.entries(AGENTS).map(([name, adapter]) => [
    name,
    adapter.setup({
      env: () => sessionBase(process.env, packages.keyNames()),
      timeoutMs: AGENT_TIMEOUT_MS,
      workDir: stateDir,
      checkedCli: () => configStore.current.cli[name] !== 'system',
      log: (line) => console.log(line),
      onCliChange: () => void cliVersions.check(),
      transport: (home): string | null => transportOf(home.agent, ledger.accounts[home.key]?.transport, account.apiKey(home.key)),
      unattended: () => configStore.current.unattended,
      language: () => configStore.current.language ?? promptLanguage(),
    }),
  ]),
)
/** The agent of an account folder: every session of the folder runs on it. */
const agentOf = (home: AccountHome): Agent => runtimes.get(home.agent)!
const envOf = (home: AccountHome) => agentOf(home).env(home)
const launchIn = (home: AccountHome, start: SessionStart) => agentOf(home).launch(home, start)
const resumeIn = (home: AccountHome, session: SessionHandle, start: SessionStart) => agentOf(home).resume(home, session, start)
const stopIn = (home: AccountHome, session: SessionHandle) => agentOf(home).stop(home, session)
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
const readerTasks = new ReaderTasks({
  owner: ownerOfReader,
  readers: (project) => readerIds(configStore.current, project),
  belongs: (reader, task) => readerFor(ownerOfReader(reader), task) === reader,
  tasksByProject,
  get dispatcher() {
    return dispatcher
  },
})
const trackers = new Trackers({
  adapters: ADAPTERS,
  start: (view, setup) =>
    startTracker(view, setup, {
      repoOf: (reader) => configStore.current.projects[ownerOfReader(reader)]!,
      rulesOf: readerRules,
      links,
      tasksByProject: readerTasks,
      // A task launched through another profile is not this one's to ask for: the archive shows it (BTN-66).
      ranSince: (reader, since) => {
        const project = ownerOfReader(reader)
        const profile = profileFor(profiles.current(), reader, readers().trackers[reader]!)?.id
        const own = launches.filter((entry) => entry.profile === undefined || entry.profile === profile)
        return ranSince(own, project, since).filter((task) => readerFor(project, task) === reader)
      },
      dispatcher: readerTasks,
      fillsMilestone: (reader) => configStore.current.settings[ownerOfReader(reader)]?.fillMilestone ?? false,
      mainBranch: (reader) => branchOf(ownerOfReader(reader)),
      readKey: (reader) => readKeyOf(readers(), reader),
      broadcast: () => hub.broadcast('state', getState()),
      refreshers,
    }),
  tasksByProject: readerTasks,
  refreshers,
  log: (line) => console.log(line),
})
/**
 * The token of the project's CI on the remote: a GitHub profile's (BTN-200) or the Forgejo profile's on its host
 * (BTN-201), the one its `remoteProfiles` names first (BTN-231).
 */
const ciTokenOf = (project: string, target: CiTarget) =>
  ciToken(target, profiles.current(), project, configStore.current.trackers[project]!, configStore.current.settings[project]?.remoteProfiles)
/** The remotes whose CI takes the profile's token, shown or not. */
const ciOn = (profileId: string, hidden: boolean) =>
  ciWatches
    .places(hidden)
    .filter(({ project, target }) => ciTokenOf(project, target)?.profile === profileId)
    .map(({ project, target }) => ({ project, remote: target.remote }))
const pullRefusals = new PullRefusals()
const remotes = new ProjectRemotes(runGit)
const ciWatches = new CiWatches({
  targets: (repo) => projectTargets(runGit, repo),
  watch: (project, repo, target) =>
    new CiWatch({
      target,
      source: ciSource(target, ciTokenOf(project, target)?.token ?? null, CI_TIMEOUT_MS),
      git: runGit,
      repo,
      main: () => branchOf(project),
      log: (message) => console.log(message),
      onChange: () => {
        hub.broadcast('state', getState())
        dispatcher.check()
      },
    }),
  source: (project, target) => ciSource(target, ciTokenOf(project, target)?.token ?? null, CI_TIMEOUT_MS),
  log: (message) => console.log(message),
})
/** The setting; an installation from before it that has not chosen keeps what Tally already ran on (BTN-247). */
const tallyMode = () => configStore.current.tally ?? inferredTallyMode(process.env, existsSync(join(stateDir, 'tally', 'pgdata')))
const newTally = () =>
  new TallyService({
    mode: tallyMode(),
    root,
    home: dataHome,
    stateDir,
    env: process.env,
    intervalMs: TALLY_INTERVAL_MS,
    firstDelayMs: TALLY_FIRST_DELAY_MS,
    evenKeelUrl: () => `http://${['0.0.0.0', '::'].includes(listen.host) ? '127.0.0.1' : listen.host}:${listen.port}`,
    huly: () => {
      const set = profiles.current()
      const config = readers()
      // By the Huly project, which Tally knows the tasks by; a feed is a reader of its own (BTN-66).
      const projects = Object.entries(config.trackers).flatMap(([project, kind]) => {
        const values = kind === 'huly' ? profileFor(set, project, kind)?.values : undefined
        return values === undefined ? [] : [[idPrefixOf(config, project), values] as const]
      })
      const elsewhere = Object.entries(config.trackers).flatMap(([project, kind]) => (kind === 'huly' ? [] : [idPrefixOf(config, project)]))
      const byId = Object.fromEntries(set.profiles.filter((profile) => profile.kind === 'huly').map((profile) => [profile.id, profile.values]))
      return { projects: Object.fromEntries(projects), fallback: defaultProfile(set, 'huly')?.values ?? null, elsewhere, byId }
    },
    log: (message) => console.log(message),
    changed: () => hub.broadcast('state', getState()),
  })
let tally = newTally()
/** What `tally` runs on (`tallyKey`), and the restarts in turn: the page and `.env` may change it at once. */
let tallyRuns = tallyKey(tallyMode(), process.env)
let tallyRestarts = Promise.resolve()
/** The project's pinned checkpoint threshold, its own over the shared one; `null` — calibrated. */
const pinnedCheckpoint = (project: string | undefined) =>
  (project === undefined ? undefined : configStore.current.settings[project]?.checkpointTokens) ?? configStore.current.stats.checkpointTokens
// Tally knows a project by its key: projects that share one are one project of the stats, on the first one's repository.
const stats = new StatsReader(
  tally.reader,
  () => Object.fromEntries(Object.entries(firstByKey(configStore.current)).map(([key, project]) => [key, configStore.current.projects[project]!])),
  () => configStore.current.stats,
  (key) => pinnedCheckpoint(firstByKey(configStore.current)[key]),
)
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

const reach = new Reachability({
  probe: (url) => answers(url, NETWORK_PROBE_MS),
  ttlMs: OFFLINE_RETRY_MS,
  now: () => Date.now(),
  onChange: (url, up) => console.log(up ? `network: ${url} answers again` : `network: ${url} does not answer; account checks and /usage wait for it`),
})
const online = (home: AccountHome) => reach.up(providerUrl(home.agent))

const limits = new LimitsWatcher({
  file: limitsFile,
  intervalMs: LIMITS_POLL_MS,
  homes: () => homes.list(),
  ownerOf: (configDir) => homes.ownerOf(configDir),
  usage: (home) => {
    const { usage } = agentOf(home)
    return usage === undefined ? undefined : (at) => usage(home, at)
  },
  usageIntervalMs: USAGE_POLL_MS,
  online,
  offlineRetryMs: OFFLINE_RETRY_MS,
  notBefore: (key) => ledger.accounts[key]?.since ?? null,
  accessExpired: (home) => {
    const { accessExpiresAt } = homes.times(home)
    return accessExpiresAt !== null && accessExpiresAt <= Date.now()
  },
  ready: (): boolean => account.ready,
  apiKey: (key): boolean => account.apiKey(key),
  onChange: () => hub.broadcast('state', getState()),
  onError: (error) => console.error(`limits:${error instanceof Error ? error.message : String(error)}`),
})

const release = installed(root)
const updates = new UpdateWatcher({
  repo: release.repo,
  current: release.version,
  enabled: () => configStore.current.updates.check && !firstRun(tallyMode(), Object.keys(configStore.current.projects).length),
  intervalMs: UPDATE_POLL_MS,
  onChange: () => hub.broadcast('state', getState()),
  log: (line) => console.log(line),
})
const releasesView = () => updatesView(release.version, updates.releases, { ...configStore.current.updates, dismissed: dismissedUpdate ?? null })
const updater = new Updater({
  root,
  home: dataHome,
  source,
  packageName: release.name,
  current: release.version,
  storage: { schema: SCHEMA_VERSION, database: SQLITE_VERSIONS + DATABASE_STEPS.length, tally: TALLY_SCHEMA_VERSION },
  startedAt,
  active: () => dispatcher.state.active,
  stateUrl: () => stateUrlOf(listen.host, listen.port),
  onChange: () => hub.broadcast('state', getState()),
  log: (line) => console.log(line),
})

const cliVersions = new VersionWatcher({
  agents: () =>
    [...runtimes].flatMap(([name, agent]) => {
      const version = agent.version?.bind(agent)
      if (version === undefined) return []
      return [{ name, title: AGENTS[name]!.title, checked: AGENTS[name]!.checked, installed: () => agent.installed?.() !== false, version }]
    }),
  intervalMs: CLI_VERSION_POLL_MS,
  onChange: () => hub.broadcast('state', getState()),
  log: (line) => console.log(line),
})

const daemons = new DaemonRefresh({
  share: (home) => homes.share(home),
  running: async (home) => liveSessions(await agentOf(home).sessions(home), home.key).length,
  daemon: async (home) => {
    const agent = agentOf(home)
    const wanted = agent.pinned?.() ?? null
    const running = wanted === null ? null : ((await agent.daemonVersion?.(home)) ?? null)
    return running === null ? null : { running, wanted: wanted! }
  },
  stopDaemon: async (home) => agentOf(home).stopDaemon?.(home),
  onChange: () => hub.broadcast('state', getState()),
  onError: (error) => console.error(`account: ${error instanceof Error ? error.message : String(error)}`),
})

const secrets = new Secrets({
  catalog: secretCatalog(),
  envFile: join(dataHome, '.env'),
  settingsFile: () => join(homes.global.dir, 'settings.json'),
  env: process.env,
  outer: (name) => envFile.isOuter(name),
  applied: () => envFile.reload(),
  host: () => listen.host,
  expired: () => void daemons.expire(homes.global),
  sessionsPending: () => daemons.pending(homes.global.key),
  onChange: () => hub.broadcast('state', getState()),
})

const profiles: Profiles = new Profiles({
  db,
  writes,
  kinds: profileKindsOf,
  set: importedProfiles,
  // Feeds too (BTN-66): a profile a feed reads on is in use, and its kind is checked like a project's.
  projects: () => {
    const { keys, trackers: kinds } = readers()
    return Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, { key, kind: kinds[id]! }]))
  },
  settingsFile: () => join(homes.global.dir, 'settings.json'),
  expired: () => void daemons.expire(homes.global),
  ci: (id) => ciOn(id, false),
  hiddenCi: (id) => ciOn(id, true),
  checkRules: (set, id, rules) => checkProfileRules(configStore.current, set, id, rules),
  deniedPulls: (id) => pullRefusals.of(id, (project, target) => (pullRequestsOn(project) ? ciTokenOf(project, target) : null)),
  timeoutMs: TRACKER_CHECK_MS,
  log: (line) => console.log(line),
  onChange: (set) => {
    trackers.apply(readers(), set)
    ciWatches.tokensChanged()
    dispatcher.check()
    hub.broadcast('state', getState())
  },
  onCheck: () => {
    dispatcher.check()
    hub.broadcast('state', getState())
  },
})
/** The tracker refused the credentials of the profile the project runs on: its chain waits (BTN-200). */
const profileBlock = (project: string): Notice | undefined => {
  const refused = profiles.refused(project)
  return refused === undefined ? undefined : notice('profiles.paused', { profile: refused.name, project: projectLabel(configStore.current, project) })
}
/** Whether pull requests of the project in PR mode have where to go, by the remotes given (EKR-12). */
const pullReadinessOf = (project: string, urls: Remote[]) => pullReadiness(project, urls, (target) => ciTokenOf(project, target)?.token ?? null)
/**
 * PR mode with nowhere to open pull requests: no session of the project starts (EKR-12). The remotes are those
 * reread each minute, so one added by hand lifts it without a restart; a project not read yet is not held.
 */
const pullBlock = (project: string): Notice | undefined => {
  const urls = remotes.urls[project]
  if (!pullRequestsOn(project) || urls === undefined) return undefined
  const ready = pullReadinessOf(project, urls)
  return 'notice' in ready ? notice('review.notReady', { project }, { cause: ready.notice }) : undefined
}

const chatTitles = new ChatTitles()
const vscode = new VsCodeAccount({
  file: vscodeSettingsFile(process.env),
  homes: () => homes.list(),
  ownerOf: (dir) => homes.ownerOf(dir),
  records: async (home) => (await agentOf(home).liveRecords?.(home)) ?? [],
  title: (home, sessionId) => chatTitles.of(join(home.dir, 'projects'), sessionId),
  intervalMs: APP_POLL_MS,
  onChange: () => hub.broadcast('state', getState()),
  onError: (error) => console.error(`vscode: ${error instanceof Error ? error.message : String(error)}`),
})

const account = new AccountWatcher({
  homes,
  agentOf,
  apps: {
    list: () => [vscode.view],
    refresh: () => vscode.refresh(),
    point: (_app, home) => vscode.point(home),
  },
  prepare: (home) => daemons.prepare(home),
  active: () => activeAccount(),
  activate: (key) => {
    configStore.saveActive(homes.find(key)?.agent ?? CLAUDE, key)
    hub.broadcast('state', getState())
    dispatcher.check()
  },
  forget: (key) => saveAccounts(forgetAccount(ledger, key)),
  nameOf: (key) => ledger.accounts[key]?.name ?? null,
  name: (key, name) => saveAccounts(nameAccount(ledger, key, name)),
  transportOf: (home, apiKey) => transportOf(home.agent, ledger.accounts[home.key]?.transport, apiKey),
  chooseTransport: (key, transport) => {
    saveAccounts(chooseTransport(ledger, key, transport))
    console.log(`account: ${key} starts its sessions on ${transportOf(CLAUDE, transport ?? undefined, account.apiKey(key))}${transport === null ? ' by default' : ''}`)
  },
  loginBlock:(): LoginBlock | null => loginBlock(dispatcher.state.active, agents, activeAccount()),
  sessionsIn: (key) => liveSessions(agents, key),
  projectsOn: (key) => projectsByAccount(configStore.current, Object.keys(configStore.current.projects))[key] ?? [],
  pool: () => poolEntries(configStore.current, Object.keys(configStore.current.projects)),
  makeShared: (agent, key) => {
    configStore.saveSharedAccount(agent, key)
    console.log(`accounts: ${key} is the shared ${agent} account, the shared one named no folder`)
    dispatcher.check()
  },
  missing: () => [...runtimes].flatMap(([name, agent]) => (agent.installed?.() === false ? [name] : [])),
  online,
  sessionsKnown: () => agentsRead,
  removing: (key) => ledger.removing.includes(key),
  markRemoving: (key, on) => saveAccounts(markRemoving(ledger, key, on)),
  configPending: (key) => daemons.pending(key),
  limits: (key) => limits.limits(key),
  usage: (key) => limits.usage(key),
  checkKey: (agent, key) => KEY_CHECKS[keyProvider(agent, key)](key, KEY_CHECK_TIMEOUT_MS),
  keyCheckMs: KEY_CHECK_MS,
  checkCredit: (agent, key) => CREDIT_CHECKS[keyProvider(agent, key)](key, KEY_CHECK_TIMEOUT_MS),
  creditCheckMs: CREDIT_CHECK_MS,
  intervalMs: ACCOUNT_POLL_MS,
  loginTimeoutMs: LOGIN_TIMEOUT_MS,
  now: () => new Date(),
  onChange: () => {
    let changed = false
    for (const entry of account.view.accounts) {
      const noted = noteAccount(ledger, entry.key, entry.status?.loggedIn === true ? entry.status.email : null, new Date())
      if (noted === undefined) continue
      saveAccounts(noted)
      changed = true
    }
    if (changed || limits.deferred) limits.refresh()
    hub.broadcast('state', getState())
    dispatcher.check()
  },
  onError: (error) => console.error(`account: ${error instanceof Error ? error.message : String(error)}`),
})

const owners = new TranscriptOwners({
  homes: () => homes.list(),
  transcripts: (home) => agentOf(home).transcripts(home),
  rescanMs: OWNERS_RESCAN_MS,
  onChange: () => hub.broadcast('state', getState()),
  onError: (error) => console.error(`sessions: ${error instanceof Error ? error.message : String(error)}`),
})

/** The e-mail a folder had at `at` (the folder's account may change), else its current one. */
const emailAt = (key: string, at: string | null): string | null =>
  (at === null ? null : accountAt(ledger, key, at)) ?? account.emailOf(key)

const sessionAccount = (sessionId: string | null, at: string | null): string | null => {
  if (sessionId === null) return null
  const live = sessions.find((view) => view.sessionId === sessionId)
  if (live !== undefined) return live.account
  const key = owners.of(sessionId)
  return key === undefined ? null : emailAt(key, at)
}

/** The account folder `key` (the active one unless given) as the chain judges a launch in it. */
const accountNow = (key = account.view.active) => {
  const view = account.view
  const entry = view.accounts.find((each) => each.key === key)
  const email = entry?.status?.loggedIn === true ? entry.status.email : null
  return { id: accountId(key, email), ready: email !== null && launchBlock(view, key) === undefined }
}

const contextWindows = new ContextWindows({
  probe: async (key, model, task) => {
    const home = homeOf(key)
    return (await agentOf(home).contextWindow?.(home, model, settingsFor(task))) ?? null
  },
  stamp: async (key) => {
    const home = homeOf(key)
    return (await agentOf(home).windowStamp?.(home)) ?? ''
  },
  recheckMs: WINDOW_RECHECK_MS,
  onError: (error) => console.warn(`context window: ${error instanceof Error ? error.message : String(error)}`),
})

const monitor = new SessionMonitor({
  agentOf,
  homes: () => homes.list(),
  emailOf: (key) => account.emailOf(key),
  apiKey: (key) => account.apiKey(key),
  // The stems name the fix sessions (`<KEY>-FIX`), the prefixes the tasks of projects whose ids are the tracker's own.
  projectKeys: () => {
    const config = configStore.current
    const projects = Object.keys(config.projects)
    return [...new Set([...projects.map((project) => fixStem(config.keys, project)), ...projects.map((project) => idPrefixOf(config, project))])]
  },
  contextWindow: (key, model, task) => (agentOf(homeOf(key)).contextWindow === undefined ? null : contextWindows.peek(key, model, task)),
  approval: (sessionId) => approvals.ask(sessionId),
  intervalMs: SESSION_POLL_MS,
  onAgents: (list) => {
    const before = JSON.stringify(account.view.loginBlock)
    agents = list
    agentsRead = true
    approvals.settle(new Set(list.filter((agent) => agent.status === 'waiting').map((agent) => agent.sessionId)))
    if (JSON.stringify(account.view.loginBlock) !== before) hub.broadcast('state', getState())
  },
  onChange: (views) => {
    sessions = views
    logStartupDialogs(views)
    hub.broadcast('state', getState())
    dispatcher.check()
    settleMail(mailRelay)
  },
  onError: (error) => console.error(`sessions: ${error instanceof Error ? error.message : String(error)}`),
})

const wedgedSessions = new Set<string>()

function logStartupDialogs(views: SessionView[]): void {
  for (const view of views) {
    if (view.startupDialog === null || wedgedSessions.has(view.sessionId)) continue
    wedgedSessions.add(view.sessionId)
    console.warn(`sessions: ${view.task} hangs on a Claude Code dialog before its first turn: ${view.startupDialog} (session ${view.sessionId}, ${view.cwd})`)
  }
  for (const view of views) {
    const key = `${view.sessionId}@${view.hungSince}`
    if (view.hungSince === null || wedgedSessions.has(key)) continue
    wedgedSessions.add(key)
    console.warn(`sessions: the turn of ${view.task} has written nothing since ${view.hungSince} and is taken for hung (session ${view.sessionId})`)
  }
}

const liveView = (task: string) => sessions.find((each) => each.task === task && each.lamp !== 'finished')

/** Whether a message goes into the live session mid-turn without its mailbox (`AgentEntry.steers`, BTN-291). */
const steering = (sessionId: string) => agents.some((each) => each.sessionId === sessionId && each.steers === true)

/** A session just resumed is mid-turn until the daemon shows it working, which lags the resume by seconds (BTN-307). */
const agentStatus = (task: string) => {
  const view = liveView(task)
  if (view === undefined) return undefined
  if (monitor.holds.turning(view.sessionId, view.ask?.id ?? null)) return 'busy'
  const agent = agents.find((each) => each.sessionId === view.sessionId)
  return turnStatus(agent?.status, view.lastActivityAt, new Date(), view.lamp === 'limit', agent?.state === 'blocked')
}

const knownTask = (task: string) => [...tasksByProject.values()].flat().find((each) => each.id === task)
/** A pool entry counts only while its folder exists and belongs to the provider it is filed under. */
const hasAccount = (provider: string, key: string) => homes.find(key)?.agent === provider

/** What a new session of the task (or of the fix session `task`) runs on, and in which account folder. */
const choiceFor = (project: string | undefined, task?: string): RunChoice =>
  runChoice(task === undefined ? undefined : knownTask(task), runSettings(configStore.current, project), hasAccount)

const planFor = (task: string, prompt: string, project = projectOf(task)): LaunchPlan => {
  const full = withUnattended(prompt, dispatcher.state.unattended, promptLanguage(project))
  const plan = launchPlan(knownTask(task), full, runSettings(configStore.current, project), configStore.current.modelPrompts, hasAccount)
  if (plan.warning !== null) console.warn(plan.warning)
  return plan
}

/** What a session also gets: the project's packages, and the global execution mode for an agent other than Claude Code. */
const agentExtras = (home: AccountHome, project: string | undefined, task: string): Pick<SessionStart, 'bypassSandbox' | 'mcp' | 'plugins'> => ({
  ...(home.agent !== CLAUDE && configStore.current.execution[home.agent] === 'bypass' ? { bypassSandbox: true } : {}),
  ...(project === undefined ? {} : packages.startOf(project, task)),
})

const noAccountFor = (task: string, fallback: string, provider: string) =>
  notice('chain.noAccountFor', {
    task,
    label: runLabelText({ provider: fallback, model: null }),
    provider: runLabelText({ provider, model: null }),
  })

/** A draft is written in the project's main checkout, on the account and model a new session of its chain would get. */
const changelogs = new ChangelogDrafts({
  tasks: async (project, milestone) => {
    const link = linkOf(project)
    if (link === undefined) throw fail('tracker.noProject', { project })
    const tasks = await link.run(async (tracker) => tracker.milestoneTasks?.(project, milestone))
    if (tasks === undefined) throw fail('changelog.cannotList', { project })
    return tasks
  },
  write: async (project, prompt) => {
    const { account, model } = choiceFor(project)
    const home = homeOf(account)
    const agent = agentOf(home)
    if (agent.write === undefined) throw fail('changelog.noAgent', { project })
    console.log(`changelog: ${project} writes a draft on ${home.key}`)
    try {
      const { text, spend } = await agent.write(home, { cwd: configStore.current.projects[project]!, prompt, model, timeoutMs: CHANGELOG_TIMEOUT_MS })
      console.log(`changelog: ${project} draft on ${home.key} cost ${spend.cost === null ? 'unknown' : `$${spend.cost.toFixed(2)}`}`)
      return { text, spend: { ...spend, account: home.key } }
    } catch (error) {
      throw fail('changelog.failed', { project }, { detail: error instanceof Error ? error.message : String(error) }, { cause: error })
    }
  },
  file: async (project) => {
    const path = configStore.current.settings[project]?.changelog ?? DEFAULT_CHANGELOG
    const file = join(configStore.current.projects[project]!, ...path.split('/'))
    const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    return { path, text: text?.replace(/\r\n/g, '\n') ?? null }
  },
  tags: async (project) => {
    const listed = await runGit(configStore.current.projects[project]!, ['tag', '--list'])
    return listed.code === 0 ? listed.out.split('\n').map((tag) => tag.trim()).filter(Boolean) : []
  },
  commit: async (project, path, message, change) => {
    const sha = await commitChangelog(runGit, configStore.current.projects[project]!, { branch: branchOf(project), path, message, change })
    console.log(sha === null ? `changelog: ${project} ${path} is already as written` : `changelog: ${project} committed ${path} as ${sha.slice(0, 7)}`)
    return sha
  },
  db,
  now: () => new Date(),
})
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

const briefed = async (task: string, given: string, project = projectOf(task)): Promise<string> => {
  if (project === undefined) return given
  const reader = readerFor(project, task)
  const prompt = withTracker(given, trackerPlace(reader), promptLanguage(project))
  if (!briefOn(project, reader)) return prompt
  const link = linkOf(reader)
  return link === undefined ? prompt : withBrief(prompt, await link.run(async (tracker) => tracker.brief?.(task)), promptLanguage(project))
}

/** The project's own prompt, for a new session only: a resumed one already has it. */
const withProject = (prompt: string, project: string | undefined): string =>
  withProjectPrompt(prompt, project === undefined ? null : (configStore.current.settings[project]?.prompt ?? null), promptLanguage(project))

/** The settings files whose `enabledPlugins` a chain session would read. */
const pluginSettings = (repo: string) =>
  [join(homes.global.dir, 'settings.json'), join(repo, '.claude', 'settings.json'), join(repo, '.claude', 'settings.local.json')].map(readJson)

const settingsFor = (task: string, project = projectOf(task)): string | undefined =>
  project === undefined
    ? undefined
    : chainSettings(
        configStore.current.projects[project]!,
        packages.otherPlugins(project, task, pluginSettings(configStore.current.projects[project]!)),
        dispatcher.state.trimTools,
        configStore.current.hiddenSkills,
        homes.global.dir,
        configStore.current.settings[project]?.cacheTtl ?? null,
      )

function projectOf(task: string): string | undefined {
  for (const [project, tasks] of tasksByProject) if (tasks.some((each) => each.id === task)) return project
  const fixed = isFixName(task) ? projectOfFix(configStore.current.keys, task) : undefined
  return fixed ?? dispatcher.state.active.find((chain) => chain.current?.task === task)?.project
}

const slotsSeen = new Map<string, number>()
/** How many slots the project's tasks may be in: the most it had since the start, so a pool shrunk on the fly still finds its busy slots. */
function slotSpan(project: string): number {
  const span = Math.max(slotsSeen.get(project) ?? 0, configStore.current.slots[project] ?? 0)
  slotsSeen.set(project, span)
  return span
}

const places = new TaskPlaces({
  git: runGit,
  main: branchOf,
  place: async (project, task, { ahead = false, at } = {}) => {
    const repo = configStore.current.projects[project]!
    const main = branchOf(project)
    await requireBranch(runGit, repo, project, main)
    if (!ahead) await requireCheckedOut(runGit, repo, project, main)
    await ensureIgnored(runGit, repo)
    // Not ahead: while the chain waits for the CI or the commands after green, main must stay at the commit they judge.
    if (!ahead) await fastForwardMain(runGit, repo, main)
    const count = configStore.current.slots[project]
    const span = slotSpan(project)
    if (isFixName(task)) return prepareWorktree(runGit, repo, task, main, ahead)
    if (count === undefined) return (span > 0 ? await heldSlot(runGit, repo, task, span) : undefined) ?? prepareWorktree(runGit, repo, task, main, ahead)
    const pool = { count, span, main, ahead, occupancy: (path: string) => slotUse(path, task), vacate: (path: string) => vacateSlot(path, task) }
    return prepareSlot(runGit, repo, task, at === undefined ? pool : { ...pool, at })
  },
  setUp: (project, task, path) => runBeforeStart(configStore.current.settings[project]?.beforeStart ?? [], taskRun(task, path, choiceFor(project, task).account)),
})

/** Keeps a done task the chain ran in the database's archive, by what its tracker last said of it. */
function archiveClosed(project: string, task: string): void {
  const { tracker, profile, url } = taskSource(project, task)
  const known = tasksByProject.get(project)?.find((each) => each.id === task)
  const closed = { project, task, tracker, title: known?.title ?? '', url, closedAt: new Date().toISOString(), profile, status: known?.status.name ?? null }
  writes.add(`the archive of ${task}`, saveClosedTask(db, closed))
  const at = archive.findIndex((each) => each.project === project && each.task === task)
  if (at >= 0) archive.splice(at, 1)
  archive.push(closed)
}

/** The launch with where its task is read from (BTN-66); a fix session has no tracker task. */
function withSource(entry: LaunchEntry): LaunchEntry {
  if (isFixName(entry.task) || configStore.current.projects[entry.project] === undefined) return entry
  const { profile, url } = taskSource(entry.project, entry.task)
  const title = tasksByProject.get(entry.project)?.find((each) => each.id === entry.task)?.title
  return { ...entry, ...(profile === null ? {} : { profile }), ...(url === null ? {} : { url }), ...(title === undefined ? {} : { title }) }
}

/** Where a project's task is read from (BTN-66): its tracker, the profile it runs on and its link. */
function taskSource(project: string, task: string): { tracker: string; profile: string | null; url: string | null } {
  const reader = readerFor(project, task)
  const tracker = readers().trackers[reader]!
  return {
    tracker,
    profile: profileFor(profiles.current(), reader, tracker)?.id ?? null,
    url: issueLink(trackers.setupOf(reader)?.issueUrl(reader) ?? null, task),
  }
}

/** A run of the project's commands for `task` (the project itself for `afterGreen`), in the environment of the account its sessions run on. */
function taskRun(task: string, cwd: string, account: string): SetupRun {
  const env = () => accountEnv(account, (key) => homes.find(key), envOf, sessionBase(process.env, packages.keyNames()))
  return { task, cwd, shell: systemShell(env), log: (line) => console.log(line) }
}

/** Syncs the project's main with its remotes the way the cleanup after Done does. */
async function syncProject(project: string): Promise<Notice | null> {
  const repo = configStore.current.projects[project]!
  const remotes = (await runGit(repo, ['remote'])).out.split(/\s+/).filter(Boolean)
  return remotes.length === 0 ? null : syncMain(runGit, repo, remotes, branchOf(project))
}

const dispatcher = new Dispatcher(await loadChainState(db), {
  projects: () => Object.keys(configStore.current.projects),
  parallel: () => configStore.current.parallel,
  rules: rulesOf,
  launch: async (project, task, extra) => {
    const home = homeOf(choiceFor(project, task).account)
    await daemons.prepare(home)
    const place = await places.ready(project, task)
    const started = withProject(await briefed(task, startPrompt(task, place, promptLanguage(project), branchOf(project), pullRequestsOn(project)), project), project)
    const { prompt, model, provider, fallback } = planFor(task, extra === undefined ? started : `${started}\n${extra}\n`, project)
    const extras = agentExtras(home, project, task)
    const sessionId = await launchIn(home, { name: task, cwd: place.path, prompt, model, settings: settingsFor(task, project), ...extras })
    if (fallback === null) return { sessionId }
    console.warn(englishOf(noAccountFor(task, fallback, provider)))
    return { sessionId, fallback }
  },
  liveSession: (task) => sessions.find((view) => view.task === task && view.lamp !== 'finished')?.sessionId,
  blocked: (project, task) => profileBlock(project) ?? pullBlock(project) ?? launchBlock(account.view, choiceFor(project, task).account),
  busy: (task) => {
    const status = agentStatus(task)
    return status === 'busy' || status === 'waiting'
  },
  midTurn: (task) => agentStatus(task) === 'busy',
  shell: (task) => {
    const view = liveView(task)
    return view !== undefined && agents.find((agent) => agent.sessionId === view.sessionId)?.status === 'shell'
  },
  asked: (task) => liveView(task)?.ask?.id ?? null,
  save: (state) => {
    writes.add('the chain state', saveChainState(db, state))
    hub.broadcast('state', getState())
  },
  journal: (launched) => {
    const entry = withSource(launched)
    writes.add(`the launch of ${entry.task}`, appendLaunch(db, entry))
    launches.push(entry)
    console.log(launchLine(entry))
  },
  now: () => new Date(),
  limited: (task) => monitor.limited(task),
  handoff: (task) => monitor.handoff(task),
  locate: locateWorktree,
  account: (project, task) => accountNow(choiceFor(project, task).account),
  accountAt: (key, at) => accountId(key, accountAt(ledger, key, at)),
  limitReset: (project, task) => exhaustedReset(limits.limits(choiceFor(project, task).account)),
  limitResetAfter: (key, at) => (account.apiKey(key) ? account.creditBackAfter(key, at) : limitResetAfter(limits.limits(key), at)),
  packagesBlocked: (project) => packages.blocked(project),
  accountsRead: () => account.ready,
  promptLanguage: (task) => promptLanguage(projectOf(task)),
  mainBranch: (task) => {
    const project = projectOf(task)
    return project === undefined ? DEFAULT_BRANCH : branchOf(project)
  },
  pullRequests: (task) => {
    const project = projectOf(task)
    return project !== undefined && pullRequestsOn(project)
  },
  resume: (task, session) => resumeWith(task, session, resumePrompt(promptLanguage(projectOf(task)))),
  reply: (task, session, prompt) => resumeWith(task, session, prompt),
  relay: async (task, session, handoff, reason) => {
    const previous = homes.find(session.account)
    if (previous !== undefined) await stopIn(previous, session)
    const project = projectOf(task)
    const home = homeOf(choiceFor(project, task).account)
    await daemons.prepare(home)
    const told = isFixName(task) ? handoff : await briefed(task, handoff)
    const { prompt, model } = planFor(task, withProject(told, project), project)
    const notePath = noteOf(session)
    const note = await readNote(notePath)
    const at = new Date().toISOString()
    const extras = agentExtras(home, project, task)
    const sessionId = await launchIn(home, { name: task, cwd: session.workdir, prompt, model, settings: settingsFor(task, project), ...extras })
    const snapshot = { at, task, sessionId, previous: session.sessionId, reason: snapshotReason(reason), prompt, notePath, note }
    writes.add(`the handoff snapshot of ${task}`, saveSnapshot(db, snapshot))
    return sessionId
  },
  launchFix: async (project, name, report) => {
    const home = homeOf(choiceFor(project).account)
    await daemons.prepare(home)
    const place = await places.ready(project, name)
    const { prompt, model } = planFor(name, withProject(fixPrompt(report, place, promptLanguage(project), branchOf(project)), project), project)
    const extras = agentExtras(home, project, name)
    return launchIn(home, { name, cwd: place.path, prompt, model, settings: settingsFor(name, project), ...extras })
  },
  stop: (session) => stopIn(homeOf(session.account), session),
  finish: async (project, task, pull) => {
    if (!isFixName(task) && pull?.unmerged !== true) archiveClosed(project, task)
    const repo = configStore.current.projects[project]!
    const span = isFixName(task) ? 0 : slotSpan(project)
    let stopped: Notice[]
    let finished: Awaited<ReturnType<typeof finishWorktree>>
    try {
      stopped = await stopTaskSessions(repo, task, Math.max(span, 1))
      const main = branchOf(project)
      const drop = pull === undefined ? {} : { force: pull.force, remote: pull.remote }
      finished = await (span > 0 ? finishSlot(runGit, repo, task, span, main, drop) : finishWorktree(runGit, repo, task, main, drop))
    } catch (error) {
      console.error(`git: cleanup after ${task} failed: ${englishOf(noticeOf(error))}`)
      throw error
    }
    packages.release(project, task)
    const outcome = { ...finished, warnings: [...stopped, ...finished.warnings] }
    for (const warning of outcome.warnings) console.warn(`git: ${task}: ${englishOf(warning)}`)
    if (outcome.syncError !== null) console.error(`git: sync of ${project} after ${task} failed: ${englishOf(outcome.syncError)}`)
    return outcome
  },
  sync: syncProject,
  refresh: async (project) => void (await refreshProject(project)),
  log: (message) => console.log(message),
  reviews: reviewDeps({
    git: runGit,
    repo: (project) => configStore.current.projects[project]!,
    main: branchOf,
    on: pullRequestsOn,
    token: (project, target) => ciTokenOf(project, target)?.token ?? null,
    complete: async (project, task) => {
      await linkFor(project, task)?.run(async (tracker) => tracker.complete?.(task))
    },
    // The issue is named only to show the link on GitHub: a tracker that does not answer leaves the body as it is.
    closingRef: async (project, task) =>
      (await linkFor(project, task)?.run(async (tracker) => tracker.closingRef?.(task) ?? null).catch(() => null)) ?? null,
    refusals: pullRefusals,
    now: () => new Date(),
    timeoutMs: CI_TIMEOUT_MS,
  }),
  unchanged: {
    changes: (project, workdir) => changesOf(runGit, workdir, branchOf(project)),
    complete: async (project, task, comment) => {
      const link = linkFor(project, task)
      await link?.run(async (tracker) => tracker.complete?.(task))
      // The task is done whatever becomes of the comment.
      await link?.run(async (tracker) => tracker.comment?.(task, comment)).catch((error: unknown) => {
        console.warn(`chain: ${task}: the comment on the task closed with no change did not reach the tracker: ${englishOf(noticeOf(error))}`)
      })
    },
  },
  main: mainCheckDeps({
    peers: (project) => remotePeers(remotes.view, branchOf, project),
    repo: (project) => configStore.current.projects[project]!,
    main: branchOf,
    git: runGit,
    watches: (project) => (ciWatches.found ? ciWatches.shown(project) : null),
    settings: (project) => configStore.current.settings[project]?.ci ?? DEFAULT_CI,
    commands: (project) => configStore.current.settings[project]?.check ?? [],
    language: () => configStore.current.language ?? promptLanguage(),
    promptLanguage,
    create: async (task) => (await linkOf(task.project)?.run(async (tracker) => tracker.create?.(task))) ?? null,
    comment: async (task, body) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      await link?.run(async (tracker) => tracker.comment?.(task, body))
    },
    prepare: (project, task) => places.prepare(project, task),
    place: async (project, task) => (await places.readyAhead(project, task)).path,
    runCheck: (project, task, cwd) => runCheck(configStore.current.settings[project]?.check ?? [], taskRun(task, cwd, choiceFor(project, task).account)),
    afterGreen: (project) => configStore.current.settings[project]?.afterGreen ?? [],
    runAfterGreen: (project, cwd) => runAfterGreen(configStore.current.settings[project]?.afterGreen ?? [], taskRun(project, cwd, choiceFor(project).account)),
    fixName: (project) => fixNameOf(configStore.current.keys, project),
    now: () => new Date(),
  }),
})

/** Whether the checkouts of two projects are of one repository (BTN-285); `undefined` until both are read. */
function sameRepositoryOf(a: string, b: string): boolean | undefined {
  const ids = remotes.repositories
  return ids[a] === undefined || ids[b] === undefined ? undefined : sameRepository(ids[a], ids[b])
}

/**
 * A release project merges into a project of its own repository, read from both folders now: `parseConfig` has no git,
 * so a hand-made `config-import` is caught only by the carry, before it fetches anything.
 */
async function checkMergeTarget(project: string, form: ProjectForm): Promise<void> {
  const current = configStore.current
  const records = Object.entries(current.keys).map(([id, key]) => ({ id, key }))
  const into = mergeTargetOf(records, project, form.mergeInto)
  const repo = into === null ? undefined : current.projects[into]
  if (into === null || repo === undefined || into === project) return
  const [own, target] = await Promise.all([form.repo, repo].map(async (folder) => repositoryIds(await checkoutRemotes(runGit, folder), folder)))
  if (!sameRepository(own!, target!)) throw fail('config.mergeIntoForeign', { project: projectLabel(current, project), into: projectLabel(current, into) })
}

const works = new TaskWorks({
  read: (project) =>
    worksOf(runGit, configStore.current.projects[project]!, branchOf(project), (tasksByProject.get(project) ?? []).map((task) => task.id)),
  ttlMs: WORK_TTL_MS,
  now: () => Date.now(),
  onChange: () => hub.broadcast('state', getState()),
  log: (line) => console.warn(line),
})

const forwards = new ForwardMerger({
  pairs: () => Object.entries(configStore.current.settings).flatMap(([from, { mergeInto: into }]) => (into === null ? [] : [{ from, into }])),
  sameRepository: sameRepositoryOf,
  repo: (project) => configStore.current.projects[project]!,
  branch: branchOf,
  label: (project) => projectLabel(configStore.current, project),
  quiet: (project) => {
    const status = (task: string) => agentStatus(task)
    return chainQuiet(dispatcher.state.active.find((chain) => chain.project === project), (task) => status(task) === 'busy' || status(task) === 'waiting')
  },
  git: runGit,
  sync: syncProject,
  now: () => new Date(),
  changed: () => hub.broadcast('state', getState()),
  log: (message) => console.log(message),
})

/**
 * Settles the tool call the session's permission hook holds (BTN-269); otherwise goes on in the live session with
 * `prompt` where its agent can (an SDK session, BTN-239); otherwise stops the session and resumes it, and the page
 * keeps it working, not finished, while it is respawned.
 */
function resumeWith(task: string, session: HandoffSession, prompt: string): Promise<string> {
  return monitor.holds.during(session.sessionId, async () => {
    if (approved(task, session, prompt)) return session.sessionId
    const home = homeOf(session.account)
    const start = goOnWith(home, task, session, prompt)
    const went = await agentOf(home).reply?.(home, session, start)
    if (went != null) return went
    const started = Date.now()
    await stopIn(home, session)
    const stopped = Date.now()
    await daemons.prepare(home)
    const sessionId = await resumeIn(home, session, start)
    console.log(`sessions: ${task} resumed in ${Date.now() - started} ms (stop ${stopped - started} ms)`)
    return sessionId
  }, liveView(task)?.ask?.id ?? null)
}

/** The words that came with an allowed call wait in the session's mailbox: it goes on with its turn at once. */
function approved(task: string, session: HandoffSession, prompt: string): boolean {
  const ask = approvals.ask(session.sessionId)
  const move = ask === null ? null : approvals.answer(session.sessionId, prompt)
  if (move === null) return false
  if (move.kind === 'allow' && move.message !== null) {
    const { text, files } = replyParts(prompt, ask)
    mailbox.post(task, session.sessionId, text, files)
  }
  console.log(`sessions: ${task}: the user ${move.kind === 'allow' ? 'allowed' : 'denied'} the call the session ${session.sessionId} waited to have approved`)
  return true
}

function goOnWith(home: AccountHome, task: string, session: HandoffSession, prompt: string): SessionStart {
  const plan = planFor(task, prompt)
  const extras = agentExtras(home, projectOf(task), task)
  return { name: task, cwd: session.cwd, prompt: plan.prompt, model: plan.model, settings: settingsFor(task), ...extras }
}

/** Puts a chat message into a working session that steers (BTN-291); `false` — it is not live here after all. */
async function steer(task: string, session: HandoffSession, prompt: string): Promise<boolean> {
  const home = homeOf(session.account)
  return (await agentOf(home).reply?.(home, session, goOnWith(home, task, session, prompt))) != null
}

const mailRelay: MailRelay = {
  mailbox,
  live: (task) => {
    const view = liveView(task)
    return view === undefined ? undefined : { sessionId: view.sessionId, midTurn: agentStatus(task) === 'busy', asking: view.asking }
  },
  resume: (task, sessionId, prompt) => {
    const project = configuredProject(task)
    if (project === undefined) throw fail('config.unknownProject', { key: task })
    dispatcher.answer(project, task, sessionId, null, prompt)
  },
  language: promptLanguage,
  changed: () => hub.broadcast('state', getState()),
  log: (line) => console.log(line),
  now: () => new Date(),
}

/**
 * Saves the files into the task's folder and resumes the waiting session with the reply (invariant 1, exception 6);
 * a page message to a working session goes straight in when it steers (BTN-291), else into its mailbox when its hooks
 * take mail (BTN-181).
 */
async function answerSession(
  project: string,
  task: string,
  sessionId: string,
  ask: string | null,
  reply: Omit<Reply, 'files'> & { files: InboxFile[] },
): Promise<void> {
  const takes = reply.from === 'page' && (steering(sessionId) || mailbox.listens(sessionId))
  const { session, midTurn } = dispatcher.answerable(project, task, sessionId, ask, takes)
  const question = ask === null ? null : (liveView(task)?.ask ?? null)
  let files: string[]
  try {
    files = await saveInbox(session.workdir, reply.files)
  } catch (error) {
    throw fail('answer.file', { name: reply.files.map((file) => file.name).join(', ') }, { detail: (error as Error).message }, { cause: error })
  }
  const prompt = replyPrompt({ ...reply, files }, question, promptLanguage(project))
  if (midTurn) {
    if (steering(sessionId) && (await steer(task, session, prompt))) {
      console.log(`chain: ${task}: the user's message from the page went into the working session ${sessionId}${files.length > 0 ? ` with ${files.length} file(s)` : ''}`)
      return
    }
    if (!mailbox.listens(sessionId)) throw fail('answer.busy', { task })
    mailbox.post(task, sessionId, reply.text, files)
    console.log(`chain: ${task}: the user's message from the page waits in the mailbox of the session ${sessionId}${files.length > 0 ? ` with ${files.length} file(s)` : ''}`)
    hub.broadcast('state', getState())
    return
  }
  dispatcher.answer(project, task, sessionId, ask, prompt)
  mailbox.dismiss(sessionId)
  console.log(`chain: ${task}: the user's answer from the ${reply.from} goes to the session ${sessionId}${files.length > 0 ? ` with ${files.length} file(s)` : ''}`)
}

function occupantsOf(slot: string, task: string) {
  const owners = new Map(launches.map((entry) => [entry.sessionId, entry.task]))
  return slotOccupants(agents, owners, slot, task)
}

function slotUse(slot: string, task: string): SlotUse {
  const { idle, busy } = occupantsOf(slot, task)
  return { idle: idle.length > 0, busy: busy.map((each) => `${each.task} (${each.agent.sessionId})`) }
}

async function vacateSlot(slot: string, task: string): Promise<void> {
  const { idle, busy } = occupantsOf(slot, task)
  if (busy.length > 0) throw fail('slot.busyStart', { slot, sessions: busy.map((each) => `${each.task} (${each.agent.sessionId})`), task })
  for (const { agent, task: owner } of idle) {
    try {
      await stopIn(homeOf(agent.account ?? 'global'), { agentId: agent.id!, sessionId: agent.sessionId })
    } catch (error) {
      throw fail('slot.stopFailed', { session: agent.sessionId, owner, slot, task }, { cause: noticeOf(error) }, { cause: error })
    }
    console.log(`slot: stopped the session ${agent.sessionId} of ${owner} before ${task} took ${slot}`)
  }
}

async function stopTaskSessions(repo: string, task: string, count: number): Promise<Notice[]> {
  const own = new Set(launches.filter((entry) => entry.task === task).map((entry) => entry.sessionId))
  const slots = slotPaths(repo, count)
  const idle = agents.filter(
    (agent) =>
      agent.id !== undefined &&
      isLive(agent) &&
      (isInside(agent.cwd, taskPlace(repo, task).path) || (slots.some((slot) => isInside(agent.cwd, slot)) && own.has(agent.sessionId))) &&
      agent.status !== 'busy' &&
      agent.status !== 'waiting',
  )
  const warnings: Notice[] = []
  for (const agent of idle) {
    try {
      await stopIn(homeOf(agent.account ?? 'global'), { agentId: agent.id!, sessionId: agent.sessionId })
    } catch (error) {
      warnings.push(notice('cleanup.sessionNotStopped', { session: agent.sessionId }, { cause: noticeOf(error) }))
    }
  }
  return warnings
}

/** What holds a project the page asks to remove: its chain, live sessions of its tasks or in its folders, the places it keeps. */
function removalFacts(project: string, repo: string): RemovalFacts {
  const own = new Map(launches.filter((entry) => entry.project === project).map((entry) => [entry.sessionId, entry.task]))
  const slots = slotPaths(repo, configStore.current.slots[project] ?? 0)
  const sessions = agents
    .filter((agent) => isLive(agent) && (own.has(agent.sessionId) || [repo, ...slots].some((folder) => isInside(agent.cwd, folder))))
    .map((agent) => `${own.get(agent.sessionId) ?? agent.cwd} (${agent.sessionId})`)
  const { active, queue, leftovers } = dispatcher.state
  return {
    project,
    chain: active.some((chain) => chain.project === project) || queue.includes(project),
    sessions,
    held: dispatcher.held(project),
    leftovers: (leftovers[project] ?? []).map((leftover) => leftover.task),
  }
}

const getState = (): EvenKeelState => ({
  startedAt,
  projects: Object.keys(configStore.current.projects),
  projectKeys: configStore.current.keys,
  projectLabels: projectLabels(configStore.current),
  taskPrefixes: Object.fromEntries(Object.keys(configStore.current.keys).map((project) => [project, idPrefixOf(configStore.current, project)])),
  config: configStore.view(lockedReaders()),
  chain: {
    active: dispatcher.state.active,
    parallel: configStore.current.parallel,
    queue: dispatcher.state.queue,
    projects: dispatcher.orders(),
    skipped: dispatcher.state.skipped,
    leftovers: dispatcher.state.leftovers,
  },
  tasks: Object.keys(configStore.current.projects).flatMap((project) => {
    const listed = tasksByProject.get(project) ?? []
    const archived = archivedShown(archive, project, listed, new Date(Date.now() - RAN_SHOWN_MS))
    return [...listed, ...archived].map((task) => ({ ...task, project }))
  }),
  // A finished session's feed is read from its record; the one the chain waits on keeps it: delivering an answer stops it for a while.
  sessions: sessions.map((view) =>
    view.lamp === 'finished' && !dispatcher.state.active.some((chain) => chain.current?.sessionId === view.sessionId) ? { ...view, feed: [] } : view,
  ),
  limits: limits.limits(activeAccount()),
  usage: limits.usage(activeAccount()),
  account: account.view,
  trackers: trackers.views(),
  trackerUrls: {
    default: trackers.setupOf(null)?.issueUrl(null) ?? null,
    projects: Object.fromEntries(Object.keys(readers().projects).map((reader) => [idPrefixOf(readers(), reader), trackers.setupOf(reader)?.issueUrl(reader) ?? null])),
    pages: Object.fromEntries(Object.keys(configStore.current.projects).map((project) => [project, trackers.setupOf(project)?.projectUrl?.(project) ?? null])),
  },
  ci: Object.fromEntries([...ciWatches.byProject.keys()].map((project) => [project, ciWatches.shown(project).map((watch) => watch.view)])),
  remotes: remotes.view,
  sameRepository: Object.fromEntries(
    Object.keys(remotes.repositories).map((project) => [project, Object.keys(remotes.repositories).filter((other) => other !== project && sameRepositoryOf(project, other))]),
  ),
  pullReadiness: Object.fromEntries(
    Object.entries(remotes.urls)
      .filter(([project]) => configStore.current.projects[project] !== undefined)
      .map(([project, urls]) => {
      const ready = pullReadinessOf(project, urls)
      return [project, 'notice' in ready ? ready.notice : null]
    }),
  ),
  launches: launchDays(launches, new Date(), LAUNCH_CHART_DAYS, (project) => configStore.current.keys[project] !== undefined),
  taskSessions: taskSessions(launches, sessions, sessionAccount, (sessionId) => monitor.compactionsOf(sessionId)),
  fixes: fixEpisodes(launches).episodes,
  works: works.view(),
  context: configStore.current.context,
  configError: configStore.error ?? listenError,
  packages: packages.view(),
  secrets: secrets.view(),
  profiles: profiles.view(),
  language: configStore.current.language,
  unattended: dispatcher.state.unattended,
  trimTools: dispatcher.state.trimTools,
  tally: tallyMode(),
  tallyHealth: tally.health(),
  updates: { ...releasesView(), ...updater.view() },
  cliVersions: [...cliVersions.view(), ...daemons.outdated().map((daemon) => outdatedDaemonView(daemon, AGENTS[daemon.agent]!.title))],
  fallbacks: fallbacksSince(launches, new Date(Date.now() - FALLBACK_TOAST_MS)).map(({ at, task, project, fallback }) => ({
    at,
    task,
    notice: noAccountFor(task, fallback, runSettings(configStore.current, project).provider),
  })),
  mailbox: Object.fromEntries(
    sessions.flatMap((view): [string, SessionMail][] => {
      const mail = mailbox.of(view.sessionId)
      const steers = steering(view.sessionId)
      const listens = steers || mailbox.listens(view.sessionId)
      return listens || mail.length > 0 ? [[view.sessionId, { listens, steers, mail }]] : []
    }),
  ),
  changelogs: changelogs.writtenTasks(),
  forwards: forwards.view(),
})

// The chain's switches are Even Keel's setting rows: the page's switches write them, and `onChange` hands them to the dispatcher.
const SWITCHES: Partial<Record<keyof ChainControl, (on: boolean) => void>> = {
  setUnattended: (on) => configStore.saveChainSwitches({ unattended: on }),
  setTrimTools: (on) => configStore.saveChainSwitches({ trimTools: on }),
}
const chainControl: ChainControl = new Proxy(dispatcher, {
  get: (target, key, receiver) => SWITCHES[key as keyof ChainControl] ?? Reflect.get(target, key, receiver),
})

let server = createEvenKeelServer({
  hub,
  publicDir: join(root, 'dist', 'web'),
  getState,
  control: chainControl,
  account,
  sessions: {
    answer: ({ project, task, sessionId, ask, answers, text, files }) => answerSession(project, task, sessionId, ask, { from: 'page', answers, text, files }),
    dismissMail: (sessionId) => {
      mailbox.dismiss(sessionId)
      hub.broadcast('state', getState())
    },
  },
  settings: {
    save: async (project, form, base) => {
      if (configStore.current.projects[project] === undefined) throw fail('config.unknownProject', { key: project })
      const moved = form.tracker !== base.tracker || form.trackerProject !== base.trackerProject
      if (moved && lockedReaders().includes(project)) throw fail('config.trackerLocked', { key: projectLabel(configStore.current, project) })
      if (form.pullRequests && !base.pullRequests) {
        const ready = pullReadinessOf(project, await remotesIn(runGit, form.repo))
        if ('notice' in ready) throw fail('review.cannotEnable', { project }, { cause: ready.notice })
      }
      if (form.mergeInto !== base.mergeInto || form.repo !== base.repo) await checkMergeTarget(project, form)
      configStore.saveProject(project, form, base)
      console.log(`page: the settings of ${project} are written to the config`)
    },
    saveShared: (form, base) => {
      configStore.saveShared(form, base)
      console.log('page: the shared settings are written to the config')
    },
    check: (draft) =>
      checkDraft(
        {
          git: runGit,
          raw: () => configStore.raw(),
          adapters: ADAPTERS,
          env: profiles.valuesFor(draft.profile, draft.tracker),
          claudeConfig: () => readJson(homes.configFile(homes.global)),
          timeoutMs: TRACKER_CHECK_MS,
          user: userInfo().username,
        },
        draft,
      ),
    add: (draft) => {
      const id = configStore.addProject(draft)
      if (draft.profile !== null) profiles.link(id, draft.profile)
      console.log(`page: the project ${draft.key.trim()} is added to the config`)
    },
    remove: (project) => {
      const repo = configStore.current.projects[project]
      if (repo === undefined) throw fail('config.unknownProject', { key: project })
      const blocked = removalBlock(removalFacts(project, repo))
      if (blocked !== null) throw new NoticeError(blocked)
      configStore.removeProject(project)
      console.log(`page: the project ${project} is removed from the config; its repository, worktrees and branches are left as they are`)
    },
    addFeed: (project, { profile, ...draft }) => {
      const chosen = profile === null ? undefined : profiles.current().profiles.find((each) => each.id === profile)
      if (profile !== null && chosen === undefined) throw fail('profiles.unknown', {})
      if (chosen !== undefined && chosen.kind !== draft.tracker) throw fail('profiles.otherTracker', { profile: chosen.name, project: draft.key.trim() })
      const id = configStore.addFeed(project, draft)
      if (chosen !== undefined) profiles.link(id, chosen.id, true)
      console.log(`page: the task feed ${draft.key.trim()} is added to ${projectLabel(configStore.current, project)}`)
    },
    removeFeed: (project, feed) => {
      const key = configStore.current.feeds[project]?.find((each) => each.id === feed)?.key
      configStore.removeFeed(project, feed)
      profiles.link(feed, null, true)
      console.log(`page: the task feed ${key} is removed from ${projectLabel(configStore.current, project)}`)
    },
    linkFeed: (project, feed, profile) => {
      const found = configStore.current.feeds[project]?.find((each) => each.id === feed)
      if (found === undefined) throw fail('config.unknownFeed', {})
      if (lockedReaders().includes(feed)) throw fail('config.feedLocked', { project: projectLabel(configStore.current, project), key: found.key })
      profiles.link(feed, profile, true)
    },
    dismissUpdate: (version) => {
      dismissedUpdate = version
      writes.add('the dismissed update', setStateValue(db, 'updates.dismissed', version))
      hub.broadcast('state', getState())
    },
    muteUpdates: () => configStore.saveUpdates({ notify: false }),
    installUpdate: () => updater.update(releasesView().available),
    revertUpdate: () => updater.revert(),
    closeUpdateResult: () => updater.seen(),
  },
  packages,
  secrets: {
    set: (name, value) => {
      secrets.set(name, value)
      console.log(`page: ${name} is written`)
    },
    remove: (name) => {
      secrets.remove(name)
      console.log(`page: ${name} is removed`)
    },
  },
  tally: {
    set: async (mode, draft) => {
      if (mode === 'server') {
        const values = serverValues(draft, process.env)
        await checkServer(values, process.env)
        const changed = Object.fromEntries(Object.entries(values).filter(([name, value]) => process.env[name] !== value))
        if (Object.keys(changed).length > 0) secrets.setAll(changed)
      }
      configStore.saveTally(mode)
      console.log(`page: stats are ${mode === 'off' ? 'off' : `on, ${mode}`}`)
      await applyTally()
    },
  },
  profiles: {
    check: (draft) => profiles.check(draft),
    save: async (draft) => {
      const id = await profiles.save(draft)
      console.log(`page: the profile ${profiles.current().profiles.find((profile) => profile.id === id)?.name} is saved`)
      return id
    },
    remove: (id) => {
      const name = profiles.current().profiles.find((profile) => profile.id === id)?.name
      profiles.remove(id)
      console.log(`page: the profile ${name} is removed`)
    },
    setDefault: (id) => profiles.setDefault(id),
    setRules: (id, rules) => {
      profiles.setRules(id, rules)
      console.log(`page: the chain rules of the profile ${profiles.current().profiles.find((profile) => profile.id === id)?.name} are saved`)
    },
    link: (project, profile) => {
      if (!Object.hasOwn(configStore.current.projects, project)) throw fail('config.unknownProject', { key: project })
      if (lockedReaders().includes(project)) throw fail('config.trackerLocked', { key: projectLabel(configStore.current, project) })
      profiles.link(project, profile)
    },
    projects: (id, query) => profiles.projects(id, query),
  },
  launches: () => launches,
  sessionRecord: async (sessionId) => {
    for (const home of homes.list()) {
      const found = await agentOf(home).record(home, sessionId)
      if (found !== undefined) return { ...found, account: sessionAccount(sessionId, found.startedAt) ?? emailAt(home.key, found.startedAt) }
    }
    return undefined
  },
  transcript: (sessionId, after) =>
    inHomes(async (home) => {
      const agent = agentOf(home)
      const feed = await agent.feed(home, sessionId, after)
      if (feed !== undefined && agent.feedFile !== undefined) void transcriptWatch.keep(sessionId, () => agent.feedFile!(home, sessionId))
      return feed
    }),
  transcriptImage: async (sessionId, tool, index) => {
    const image = await inHomes(async (home) => agentOf(home).image?.(home, sessionId, tool, index))
    if (image === undefined) return undefined
    const data = Buffer.from(image.data, 'base64')
    return { type: image.type, size: data.length, body: Readable.from([data]) }
  },
  inboxFile: async (sessionId, name) => {
    const feed = await inHomes((home) => agentOf(home).feed(home, sessionId, 0))
    const found = inboxImage(feed?.lines.flatMap((line) => line.files ?? []) ?? [], name)
    if (found === undefined) return undefined
    const size = await stat(found.path).then((info) => info.size, () => null)
    return size === null ? undefined : { type: found.type, size, body: createReadStream(found.path) }
  },
  sharedFile: async (sessionId, tool, index) => {
    const feed = await inHomes((home) => agentOf(home).feed(home, sessionId, 0))
    const share = feed?.lines.find((line) => line.tool === tool && line.share !== undefined)?.share
    const found = share === undefined ? undefined : sharedFile(share, index)
    if (found === undefined) return undefined
    const size = await stat(found.path).then((info) => (info.isFile() ? info.size : null), () => null)
    return size === null ? undefined : { type: found.type, size, body: createReadStream(found.path) }
  },
  checkpoint: async (sessionId) => {
    const run = handoffsOf(launches, sessionId)
    if (run === undefined) return undefined
    const window = sessions.find((view) => view.sessionId === sessionId)?.contextWindow ?? configStore.current.context.window
    const { first, source } = await stats.checkpoint(configStore.current.keys[run.project] ?? run.project, pinnedCheckpoint(run.project))
    const shares = configStore.current.settings[run.project]?.checkpointShares ?? configStore.current.stats.checkpointShares
    return { ...run, ...withinWindow({ first, source }, window, shares), context: monitor.contextOf(sessionId) ?? null }
  },
  handoffNote: async (sessionId) => {
    if (handoffsOf(launches, sessionId) === undefined) return undefined
    const feed = await inHomes((home) => agentOf(home).feed(home, sessionId, 0))
    return feed !== undefined && noteAtEnd(feed.lines)
  },
  mail: (sessionId, event) => (handoffsOf(launches, sessionId) === undefined ? undefined : mailFor(mailRelay, sessionId, event)),
  permission: (sessionId, tool, input, since) => (handoffsOf(launches, sessionId) === undefined ? undefined : approvals.poll(sessionId, tool, input, since)),
  mergeCheck: (sessionId) => {
    const run = handoffsOf(launches, sessionId)
    if (run === undefined) return undefined
    const settings = configStore.current.settings[run.project]
    const views = ciWatches.shown(run.project).map((watch) => watch.view)
    const commands = settings === undefined ? [] : mergeCheck(settings.check, settings.ci, views)
    return { commands, branch: branchOf(run.project) }
  },
  tools: async (project) => {
    const repo = configStore.current.projects[project]
    if (repo === undefined) return undefined
    const list = homes.list()
    const used = projectsByAccount(configStore.current, Object.keys(configStore.current.projects))
    const view = await readToolsView(project, {
      repo,
      globalDir: homes.global.dir,
      configs: claudeConfigs(),
      accounts: list.filter((home) => !home.global).map(({ key, dir, agent }) => ({ key, dir, agent, used: used[key] !== undefined })),
      homes: list.map((home) => home.dir),
      trim: dispatcher.state.trimTools,
      hidden: configStore.current.hiddenSkills,
      mode: agentOf(homes.find(claudeAccount()) ?? homes.global).mode,
      reach: packages.reach(project),
    })
    const received = view.received
    return received === null ? view : { ...view, received: { ...received, account: sessionAccount(received.sessionId, received.at) } }
  },
  vocabulary: (id) => (Object.hasOwn(readers().projects, id) ? vocabularies.get(id) : Promise.resolve(undefined)),
  tasks: {
    card: async (task) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) return undefined
      return link.run(async (tracker) => {
        if (tracker.card === undefined) return undefined
        const [card, milestones] = await Promise.all([tracker.card(task), tracker.milestones?.(task) ?? null])
        return cardOf(card, rulesOf(project!, task), tracker.ready !== undefined, milestones)
      })
    },
    file: async (task, file) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) return undefined
      return link.run(async (tracker) => (await tracker.file?.(task, file)) ?? undefined)
    },
    ready: async (task) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) throw fail('task.noTracker', { task })
      const status = await link.run(async (tracker) => tracker.ready?.(task))
      if (status === undefined) throw fail('task.cannotReady', { task })
      if (status === null) throw fail('task.pastBacklog', { task })
      const reader = readerFor(project!, task)
      const tasks = readerTasks.get(reader)
      if (tasks?.some((each) => each.id === task)) {
        const updated = tasks.map((each) => (each.id === task ? { ...each, status } : each))
        readerTasks.set(reader, updated)
        readerTasks.setTasks(reader, updated)
      }
      hub.broadcast('state', getState())
    },
    // The milestone moves the task in the chain's order: the project is read anew rather than patched.
    moveMilestone: async (task, milestone) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) throw fail('task.noTracker', { task })
      const moved = await link.run(async (tracker) => (tracker.moveMilestone === undefined ? false : (await tracker.moveMilestone(task, milestone), true)))
      if (!moved) throw fail('task.cannotMoveMilestone', { task })
      await refreshers.get(readerFor(project!, task))?.()
    },
    refresh: async (project) => {
      // The page's refresh asks the forges too: otherwise a pull request is seen only by the minute's poll.
      const [read] = await Promise.all([refreshProject(project), dispatcher.pollReviews(project)])
      if (!read) throw fail('tracker.noProject', { project })
    },
  },
  changelog: async (project, milestone, op) => {
    if (!Object.hasOwn(configStore.current.projects, project)) throw fail('chain.unknownProject', { project })
    const view = await changelogs.run(project, milestone, op)
    if (op.op === 'write') hub.broadcast('state', getState())
    return view
  },
  carry: (project) => forwards.carry(project),
  stats,
  guard: () => ({ hosts: guardHosts(listen.host, configStore.current.allowedHosts), token, language: configStore.current.language ?? promptLanguage() }),
})

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
function configuredProject(task: string): string | undefined {
  const listed = projectOf(task)
  if (listed !== undefined) return listed
  const prefix = parseTaskId(task)?.project
  const all = readers()
  const reader = Object.keys(all.projects).find((each) => idPrefixOf(all, each) === prefix)
  return reader === undefined ? undefined : ownerOf(all, reader)
}

const postedQuestions = await loadQuestions(db)
const questions = new TrackerQuestions({
  sessions: () => {
    const current = dispatcher.state.active.flatMap((chain): AskingSession[] => {
      const sessionId = chain.current?.sessionId
      const view = sessionId == null ? undefined : liveView(chain.current!.task)
      if (view === undefined || view.sessionId !== sessionId || isFixName(view.task)) return []
      return [{ project: chain.project, task: view.task, sessionId, ask: view.ask, current: true }]
    })
    const aside = sessions.flatMap((view): AskingSession[] => {
      const project = configuredProject(view.task)
      if (view.lamp === 'finished' || project === undefined || current.some((each) => each.sessionId === view.sessionId)) return []
      return [{ project, task: view.task, sessionId: view.sessionId, ask: view.ask, current: false }]
    })
    return [...current, ...aside]
  },
  tracker: (project, task, call) => linkFor(project, task)?.run(call),
  language: () => configStore.current.language ?? promptLanguage(),
  load: () => postedQuestions,
  save: (posted) => writes.add('the posted questions', saveQuestions(db, posted)),
  answer: (project, task, sessionId, ask, reply) => answerSession(project, task, sessionId, ask, { from: 'tracker', ...reply }),
  log: (message) => console.log(message),
})

/** A project with `intakeLabel` on a tracker other than GitHub takes in the issues of its first github.com remote, on the token its CI takes. */
const intakePlaces = (): IntakePlace[] =>
  Object.entries(configStore.current.settings).flatMap(([project, settings]) => {
    const label = settings.intakeLabel
    if (label === null || configStore.current.trackers[project] === 'github') return []
    for (const remote of remotes.urls[project] ?? []) {
      const parsed = parseRemote(remote.url)
      if (parsed?.host !== 'github.com') continue
      const { host: _, ...repo } = parsed
      const token = ciTokenOf(project, { kind: 'github', remote: remote.name, ...repo })?.token
      if (token === undefined) return []
      const slug = `${repo.owner}/${repo.repo}`
      return [{ project, slug, label, repo: intakeRepo(slug, token, CI_TIMEOUT_MS) }]
    }
    return []
  })
const intake = new Intake({
  places: intakePlaces,
  language: (project) => configStore.current.language ?? promptLanguage(project),
  create: async (project, task) => {
    const created = await linkOf(project)?.run(async (tracker) => tracker.create?.({ project, ...task, priority: 'medium', milestoneOf: null }))
    if (created == null) throw new Error(`the tracker of ${projectLabel(configStore.current, project)} is off or cannot create a task`)
    return created
  },
  comment: async (project, task, body) => {
    await linkFor(project, task)?.run(async (tracker) => tracker.comment?.(task, body))
  },
  task: async (project, task) => {
    const found = (await linkFor(project, task)?.run(async (tracker) => tracker.tasks([task])))?.find((each) => each.id === task)
    return found === undefined ? null : { category: found.status.category, milestone: found.milestone?.label ?? null }
  },
  load: () => intakeEntries,
  save: (entries) => writes.add('the issues taken in', setStateValue(db, 'intake', entries)),
  now: () => new Date(),
  log: (message) => console.log(message),
})

setInterval(() => hub.broadcast('ping', { at: new Date().toISOString() }), 15_000).unref()
setInterval(() => void questions.tick(), 15_000).unref()
setInterval(() => settleMail(mailRelay), 15_000).unref()

setInterval(() => dispatcher.check(), LIMIT_CHECK_MS).unref()
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
setInterval(() => void forwards.tick().catch(() => {}), FORWARD_TICK_MS).unref()
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
function projectsChanged(before: EvenKeelConfig): void {
  const after = configStore.current
  for (const project of Object.keys(before.projects)) {
    if (Object.hasOwn(after.projects, project)) {
      if (before.keys[project] !== after.keys[project]) console.log(`config: ${before.keys[project]} is now ${projectLabel(after, project)}`)
      continue
    }
    dispatcher.forget(project)
    tasksByProject.delete(project)
    console.log(`config: ${projectLabel(before, project)} is gone from the config; its chain is let go, its sessions are left as they are`)
  }
  for (const project of Object.keys(after.projects)) if (!Object.hasOwn(before.projects, project)) console.log(`config: ${projectLabel(after, project)} joined`)
  trackers.apply(readersOf(after), profiles.current())
  if (JSON.stringify(before.projects) !== JSON.stringify(after.projects)) {
    void packages.projectsChanged().catch((error: unknown) => console.warn(`packages: ${(error as Error).message}`))
    applyCi()
  }
  const remoteProfiles = (config: EvenKeelConfig) => JSON.stringify(Object.entries(config.settings).map(([key, settings]) => [key, settings.remoteProfiles]))
  if (remoteProfiles(before) !== remoteProfiles(after)) ciWatches.tokensChanged()
}

monitor.start()
void owners.scan()
limits.start()
updates.start()
void updater.start().catch((error: unknown) => console.warn(`updates: ${(error as Error).message}`))
cliVersions.start()
account.start()
vscode.start()
configStore.watch()
void packages.start()
tally.start()
// What an installation from before the choice already ran on becomes its setting, so a later `.env` edit does not move it.
if (configStore.current.tally === null && tallyMode() !== null) {
  configStore.saveTally(tallyMode()!)
  console.log(`tally: stats stay ${tallyMode()}, as they ran before the setting`)
}
envFile.subscribe((changed) => void envChanged(changed))
envFile.watch()

// The local Tally database and the state database close cleanly on a stop signal; the Windows service host kills the
// process instead, and PGlite recovers from its WAL on the next start.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    setTimeout(() => process.exit(0), SHUTDOWN_MS).unref()
    void Promise.allSettled([tally.stop(), writes.settled().then(() => stateDb.close())]).finally(() => process.exit(0))
  })
}

server.listen(listen.port, listen.host, () => {
  console.log(`even-keel listening on http://${listen.host}:${listen.port}`)
})

trackers.apply(readers(), profiles.current())
profiles.start()

/** `.env` changed: whoever reads the changed variables takes them now (`docs/service.md`). */
async function envChanged(changed: string[]): Promise<void> {
  console.log(`env: ${changed.join(', ')} changed in .env`)
  const targets = envTargets(changed)
  if (targets.accounts) {
    homes.setRoots(accountsRoot(process.env), codexAccountsRoot(process.env), openCodeAccountsRoot(process.env), copilotAccountsRoot(process.env))
    account.refresh()
    limits.refresh()
    void owners.scan()
  }
  if (targets.guard) applyGuard()
  if (targets.listen) await rebind()
  if (targets.tally) await applyTally()
  dispatcher.check()
  hub.broadcast('state', getState())
}

/** Tally's mode or its database changed: the collector and the reader start anew on them; nothing when neither did. */
function applyTally(): Promise<void> {
  tallyRestarts = tallyRestarts
    .then(async () => {
      const key = tallyKey(tallyMode(), process.env)
      if (key === tallyRuns) return
      tallyRuns = key
      await tally.stop()
      tally = newTally()
      stats.setReader(tally.reader)
      tally.start()
      console.log('tally: the stats mode or database changed, the collector starts anew')
      hub.broadcast('state', getState())
    })
    .catch((error: unknown) => console.error(`tally: ${(error as Error).message}`))
  return tallyRestarts
}

/** The token as the environment has it now; a wrong one keeps the last good token and says why. */
function applyGuard(): void {
  let next: string | null
  try {
    next = guardToken(process.env, listenOf(process.env).host)
  } catch (error) {
    console.error(`guard: ${englishOf(noticeOf(error))}; the previous token stays`)
    return
  }
  if (next === token) return
  token = next
  console.log(next === null ? 'guard: no token now' : 'guard: the token changed, open pages are asked for it again')
  hub.closeAll()
}

/** Moves the page to the address the environment has now: the new server first, the old one closes only once it listens. */
async function rebind(): Promise<void> {
  let next: { host: string; port: number }
  try {
    next = listenOf(process.env)
  } catch (error) {
    listenError = noticeOf(error)
    console.error(`server: ${englishOf(listenError)}; staying on http://${listen.host}:${listen.port}`)
    return
  }
  if (next.host === listen.host && next.port === listen.port) {
    listenError = null
    return
  }
  const moved = createServer()
  for (const listener of server.listeners('request')) moved.on('request', listener as (...args: unknown[]) => void)
  try {
    await new Promise<void>((resolve, reject) => {
      moved.once('error', reject)
      moved.listen(next.port, next.host, () => resolve())
    })
  } catch (error) {
    listenError = notice('server.rebindFailed', { address: `${next.host}:${next.port}`, current: `${listen.host}:${listen.port}` }, { detail: (error as Error).message })
    console.error(englishOf(listenError))
    return
  }
  const old = server
  server = moved
  listen = next
  listenError = null
  hub.closeAll()
  old.close()
  old.closeAllConnections()
  console.log(`even-keel listening on http://${listen.host}:${listen.port}, moved from the previous address`)
}

