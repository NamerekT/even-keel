import { createReadStream, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { checkCredit } from './account/credit.js'
import { DaemonRefresh } from './account/daemon.js'
import { AccountHomes, accountsRoot, codexAccountsRoot, type AccountHome } from './account/homes.js'
import { checkApiKey, checkOpenAiKey } from './account/keycheck.js'
import { accountAt, forgetAccount, loadLedger, markRemoving, nameAccount, noteAccount, saveLedger, type AccountLedger } from './account/ledger.js'
import { accountId, launchBlock, liveSessions, loginBlock, type LoginBlock } from './account/model.js'
import { VsCodeAccount, vscodeSettingsFile } from './account/vscode.js'
import { AccountWatcher } from './account/watcher.js'
import { AGENTS } from './agent/adapters.js'
import type { Agent, SessionHandle, SessionStart } from './agent/contract.js'
import { sessionBase } from './agent/env.js'
import { updateMarketplace } from './claude/cli.js'
import { CLAUDE } from './claude/name.js'
import { CODEX } from './codex/name.js'
import { Dispatcher, type LaunchEntry } from './chain/dispatcher.js'
import { fallbacksSince, fixEpisodes, handoffsOf, launchDays, launchedProjects, taskSessions } from './chain/launches.js'
import { fixName, fixTaskOf, isFixName } from './chain/fix.js'
import { fixPrompt, noteOf, resumePrompt, startPrompt, withBrief, withProjectPrompt, withTracker, withUnattended, type HandoffSession, type TrackerPlace } from './chain/relay.js'
import { launchLine } from './chain/log.js'
import { mainCheckDeps, mergeCheck } from './chain/mainci.js'
import { TaskPlaces } from './chain/places.js'
import { readNote, saveSnapshot, snapshotReason } from './chain/snapshots.js'
import { appendLaunch, loadChainState, loadQuestions, readLaunches, saveChainState, saveClosedTask, saveQuestions } from './chain/store.js'
import { CI_TOKENS, ciSource, projectTargets } from './ci/adapters.js'
import { CiWatch } from './ci/watcher.js'
import { CiWatches } from './ci/watches.js'
import { ConfigStore } from './config-store.js'
import { DEFAULT_BRANCH, DEFAULT_CI, listenOf, mcpPortOf, poolEntries, projectsByAccount, runSettings, type EvenKeelConfig } from './config.js'
import { envTargets } from './env-file.js'
import { EventHub } from './events.js'
import { runGit } from './git/run.js'
import { finishSlot, heldSlot, prepareSlot, slotPaths, type SlotUse } from './git/slot.js'
import { ensureIgnored, finishWorktree, prepareWorktree, requireBranch, taskPlace } from './git/worktree.js'
import { exhaustedReset, limitResetAfter } from './limits/model.js'
import { LimitsWatcher } from './limits/watcher.js'
import { englishOf, fail, notice, NoticeError, noticeOf, type Notice } from './notice/notice.js'
import { guardHosts, guardToken } from './guard.js'
import { readJson } from './packages/plugins.js'
import { checkDraft } from './projects/check.js'
import { removalBlock, type RemovalFacts } from './projects/removal.js'
import { Packages } from './packages/service.js'
import { secretCatalog } from './secrets/catalog.js'
import { Secrets } from './secrets/service.js'
import { createEvenKeelServer, type ChainControl } from './server.js'
import { replyPrompt, type Reply } from './sessions/ask.js'
import { inboxImage, saveInbox, type InboxFile } from './sessions/inbox.js'
import type { SessionMail } from './sessions/mail.js'
import { Mailbox } from './sessions/mailbox.js'
import { mailFor, settleMail, type MailRelay } from './sessions/mailRelay.js'
import { isLive, turnStatus, type AgentEntry } from './sessions/agents.js'
import { launchPlan, runChoice, type LaunchPlan, type RunChoice } from './sessions/launch.js'
import { runAfterGreen, runBeforeStart, runCheck, systemShell, type SetupRun } from './sessions/setup.js'
import { SessionMonitor } from './sessions/monitor.js'
import { noteAtEnd } from './sessions/note.js'
import { TranscriptOwners } from './sessions/owners.js'
import { ChatTitles } from './sessions/title.js'
import { TranscriptWatch } from './sessions/watch.js'
import { configPath, loadEnv, root, stateDirOf } from './locations.js'
import { isInside } from './paths.js'
import { slotOccupants } from './sessions/occupants.js'
import { locateWorktree } from './sessions/place.js'
import type { EvenKeelState, SessionView } from './state.js'
import { StatsReader } from './stats/reader.js'
import { Writes } from './storage/database.js'
import { keptDatabase } from './storage/owner.js'
import { setStateValue, stateValue } from './storage/service-state.js'
import { rekeyed } from './storage/projects.js'
import { TallyService } from './stats/tally.js'
import { chainSettings, readToolsView } from './tools/panel.js'
import { ADAPTERS, trackerKeyRules } from './tracker/adapters.js'
import { cardOf } from './tracker/card.js'
import type { TrackerLink } from './tracker/link.js'
import { issueLink, parseTaskId, runLabelText, type Task } from './tracker/model.js'
import { TrackerQuestions, type AskingSession } from './tracker/questions.js'
import { startTracker } from './tracker/start.js'
import { Trackers } from './tracker/trackers.js'
import { updatesView } from './updates/release.js'
import { installed, UpdateWatcher } from './updates/watcher.js'

const SESSION_POLL_MS = 3_000
const AGENT_TIMEOUT_MS = 30_000
const LIMITS_POLL_MS = 2_000
const USAGE_POLL_MS = 5 * 60_000
const LAUNCH_CHART_DAYS = 14
const FALLBACK_TOAST_MS = 24 * 60 * 60_000
const ACCOUNT_POLL_MS = 60_000
const KEY_CHECK_MS = 60 * 60_000
const KEY_CHECK_TIMEOUT_MS = 15_000
const CREDIT_CHECK_MS = 5 * 60_000
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
const CI_TIMEOUT_MS = 15_000
const UPDATE_POLL_MS = 12 * 60 * 60_000
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
    hub.broadcast('state', getState())
  },
})
/** The version whose toast the user closed: state, not a setting (BTN-199). */
let dismissedUpdate = (await stateValue(db, 'updates.dismissed')) as string | null | undefined
const envFile = loadEnv()
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
const rulesOf = (project: string) => configStore.current.rules[project]!
const stateDir = stateDirOf()
mkdirSync(stateDir, { recursive: true })
const mailbox = await Mailbox.open(db, writes, () => new Date())
const limitsFile = join(stateDir, 'rate-limits.json')
const accountFile = join(stateDir, 'account.json')
const links = new Map<string, TrackerLink>()
/** The link of the project's tracker; `undefined` while that tracker is off. */
const linkOf = (project: string) => links.get(configStore.current.trackers[project]!)
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
  envFile: join(root, '.env'),
  get ids() {
    return configStore.current.ids
  },
  get repos() {
    return configStore.current.projects
  },
  globalDir: homes.global.dir,
  claudeConfigs,
  rules: trackerKeyRules(),
  trackerServer: (project) => (configStore.current.briefs[project] ? undefined : ADAPTERS[configStore.current.trackers[project]!]!.mcpServer),
  agentOf: (project) => homes.find(choiceFor(project).account)?.agent ?? CLAUDE,
  updateMarketplace: (marketplace) => updateMarketplace(envOf(homes.global), marketplace, PLUGIN_UPDATE_TIMEOUT_MS),
  baseEnv: (): NodeJS.ProcessEnv => sessionBase(process.env, packages.keyNames()),
  port: mcpPort,
  log: (line) => console.log(line),
  onChange: () => {
    dispatcher.check()
    hub.broadcast('state', getState())
  },
})
const runtimes = new Map<string, Agent>(
  Object.entries(AGENTS).map(([name, adapter]) => [
    name,
    adapter.setup({ env: () => sessionBase(process.env, packages.keyNames()), timeoutMs: AGENT_TIMEOUT_MS, workDir: stateDir }),
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
const launches: LaunchEntry[] = await readLaunches(db, configStore.current.ids)
const trackers = new Trackers({
  adapters: ADAPTERS,
  start: (view, setup) =>
    startTracker(view, setup, {
      repoOf: (project) => configStore.current.projects[project]!,
      rulesOf,
      links,
      tasksByProject,
      launches,
      dispatcher,
      fillsMilestone: (project) => configStore.current.settings[project]?.fillMilestone ?? false,
      mainBranch: branchOf,
      broadcast: () => hub.broadcast('state', getState()),
      refreshers,
    }),
  tasksByProject,
  refreshers,
  log: (line) => console.log(line),
})
const ciWatches = new CiWatches({
  targets: (repo) => projectTargets(runGit, repo),
  watch: (project, repo, target) =>
    new CiWatch({
      target,
      source: ciSource(target, process.env, CI_TIMEOUT_MS),
      variable: CI_TOKENS[target.kind],
      git: runGit,
      repo,
      main: () => branchOf(project),
      log: (message) => console.log(message),
      onChange: () => {
        hub.broadcast('state', getState())
        dispatcher.check()
      },
    }),
  source: (target) => ciSource(target, process.env, CI_TIMEOUT_MS),
  log: (message) => console.log(message),
})
const newTally = () =>
  new TallyService({
    root,
    stateDir,
    env: process.env,
    intervalMs: TALLY_INTERVAL_MS,
    firstDelayMs: TALLY_FIRST_DELAY_MS,
    evenKeelUrl: () => `http://${['0.0.0.0', '::'].includes(listen.host) ? '127.0.0.1' : listen.host}:${listen.port}`,
    log: (message) => console.log(message),
  })
let tally = newTally()
const stats = new StatsReader(tally.reader, () => configStore.current.projects, () => configStore.current.stats)
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
  notBefore: (key) => ledger.accounts[key]?.since ?? null,
  accessExpired: (home) => {
    const { accessExpiresAt } = homes.times(home)
    return accessExpiresAt !== null && accessExpiresAt <= Date.now()
  },
  apiKey: (key): boolean => account.apiKey(key),
  onChange: () => hub.broadcast('state', getState()),
  onError: (error) => console.error(`limits:${error instanceof Error ? error.message : String(error)}`),
})

const release = installed(root)
const updates = new UpdateWatcher({
  repo: release.repo,
  current: release.version,
  enabled: () => configStore.current.updates.check,
  intervalMs: UPDATE_POLL_MS,
  onChange: () => hub.broadcast('state', getState()),
  log: (line) => console.log(line),
})

const daemons = new DaemonRefresh({
  share: (home) => homes.share(home),
  running: async (home) => liveSessions(await agentOf(home).sessions(home), home.key).length,
  stopDaemon: async (home) => agentOf(home).stopDaemon?.(home),
  onChange: () => hub.broadcast('state', getState()),
  onError: (error) => console.error(`account: ${error instanceof Error ? error.message : String(error)}`),
})

const secrets = new Secrets({
  catalog: secretCatalog(ADAPTERS, CI_TOKENS),
  trackers: Object.fromEntries(Object.entries(ADAPTERS).map(([name, adapter]) => [name, adapter.title])),
  envFile: join(root, '.env'),
  settingsFile: () => join(homes.global.dir, 'settings.json'),
  env: process.env,
  outer: (name) => envFile.isOuter(name),
  applied: () => envFile.reload(),
  host: () => listen.host,
  expired: () => void daemons.expire(homes.global),
  sessionsPending: () => daemons.pending(homes.global.key),
  onChange: () => hub.broadcast('state', getState()),
})

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
  loginBlock: (): LoginBlock | null => loginBlock(dispatcher.state.active, agents, activeAccount()),
  sessionsIn: (key) => liveSessions(agents, key),
  projectsOn: (key) => projectsByAccount(configStore.current, Object.keys(configStore.current.projects))[key] ?? [],
  pool: () => poolEntries(configStore.current, Object.keys(configStore.current.projects)),
  sessionsKnown: () => agentsRead,
  removing: (key) => ledger.removing.includes(key),
  markRemoving: (key, on) => saveAccounts(markRemoving(ledger, key, on)),
  configPending: (key) => daemons.pending(key),
  limits: (key) => limits.limits(key),
  usage: (key) => limits.usage(key),
  checkKey: (agent, key) => (agent === CODEX ? checkOpenAiKey : checkApiKey)(key, KEY_CHECK_TIMEOUT_MS),
  keyCheckMs: KEY_CHECK_MS,
  checkCredit: (key) => checkCredit(key, KEY_CHECK_TIMEOUT_MS),
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
    if (changed) limits.refresh()
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

const monitor = new SessionMonitor({
  agentOf,
  homes: () => homes.list(),
  emailOf: (key) => account.emailOf(key),
  apiKey: (key) => account.apiKey(key),
  projectKeys: () => Object.keys(configStore.current.projects),
  intervalMs: SESSION_POLL_MS,
  onAgents: (list) => {
    const before = JSON.stringify(account.view.loginBlock)
    agents = list
    agentsRead = true
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
}

const liveView = (task: string) => sessions.find((each) => each.task === task && each.lamp !== 'finished')

const agentStatus = (task: string) => {
  const view = liveView(task)
  if (view === undefined) return undefined
  const status = agents.find((agent) => agent.sessionId === view.sessionId)?.status
  return turnStatus(status, view.lastActivityAt, new Date(), view.lamp === 'limit')
}

const knownTask = (task: string) => [...tasksByProject.values()].flat().find((each) => each.id === task)
/** A pool entry counts only while its folder exists and belongs to the provider it is filed under. */
const hasAccount = (provider: string, key: string) => homes.find(key)?.agent === provider

/** What a new session of the task (or of the fix session `task`) runs on, and in which account folder. */
const choiceFor = (project: string | undefined, task?: string): RunChoice =>
  runChoice(task === undefined ? undefined : knownTask(task), runSettings(configStore.current, project), hasAccount)

const planFor = (task: string, prompt: string, project = projectOf(task)): LaunchPlan => {
  const full = withUnattended(prompt, dispatcher.state.unattended, promptLanguage())
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

/** The account holding the Even Keel role, the one the header shows: the shared provider's entry of the shared pool. */
const activeAccount = () => configStore.current.accounts[configStore.current.provider]!

const promptLanguage = () => configStore.current.promptLanguage

const trackerPlace = (project: string): TrackerPlace | null => {
  const name = configStore.current.trackers[project]!
  const place = configStore.current.trackerProjects[project]
  return place === undefined ? null : { title: ADAPTERS[name]!.title, project: place }
}

const briefed = async (task: string, given: string, project = projectOf(task)): Promise<string> => {
  if (project === undefined) return given
  const prompt = withTracker(given, trackerPlace(project), promptLanguage())
  if (!configStore.current.briefs[project]) return prompt
  const link = linkOf(project)
  return link === undefined ? prompt : withBrief(prompt, await link.run(async (tracker) => tracker.brief?.(task)), promptLanguage())
}

/** The project's own prompt, for a new session only: a resumed one already has it. */
const withProject = (prompt: string, project: string | undefined): string =>
  withProjectPrompt(prompt, project === undefined ? null : (configStore.current.settings[project]?.prompt ?? null), promptLanguage())

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
        configStore.current.cacheTtl,
      )

function projectOf(task: string): string | undefined {
  for (const [project, tasks] of tasksByProject) if (tasks.some((each) => each.id === task)) return project
  const fixed = isFixName(task) ? Object.keys(configStore.current.projects).find((project) => fixName(project) === fixTaskOf(task)) : undefined
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
    await ensureIgnored(runGit, repo)
    const count = configStore.current.slots[project]
    const span = slotSpan(project)
    if (isFixName(task)) return prepareWorktree(runGit, repo, task, main, ahead)
    if (count === undefined) return (span > 0 ? await heldSlot(runGit, repo, task, span) : undefined) ?? prepareWorktree(runGit, repo, task, main, ahead)
    const pool = { count, span, main, ahead, occupancy: (path: string) => slotUse(path, task), vacate: (path: string) => vacateSlot(path, task) }
    return prepareSlot(runGit, repo, task, at === undefined ? pool : { ...pool, at })
  },
  setUp: (project, task, path) => runBeforeStart(configStore.current.settings[project]?.beforeStart ?? [], taskRun(task, path)),
})

/** Keeps a done task the chain ran in the database's archive, by what its tracker last said of it. */
function archiveClosed(project: string, task: string): void {
  const tracker = configStore.current.trackers[project]!
  const title = tasksByProject.get(project)?.find((each) => each.id === task)?.title ?? ''
  const url = issueLink(trackers.setup(tracker)?.issueUrl(project) ?? null, task)
  writes.add(`the archive of ${task}`, saveClosedTask(db, { project, task, tracker, title, url, closedAt: new Date().toISOString() }, configStore.current.ids))
}

function taskRun(task: string, cwd: string): SetupRun {
  return { task, cwd, shell: systemShell(() => envOf(homeOf(claudeAccount()))), log: (line) => console.log(line) }
}

const dispatcher = new Dispatcher(await loadChainState(db, configStore.current.ids), {
  projects: () => Object.keys(configStore.current.projects),
  parallel: () => configStore.current.parallel,
  rules: rulesOf,
  launch: async (project, task) => {
    const home = homeOf(choiceFor(project, task).account)
    await daemons.prepare(home)
    const place = await places.ready(project, task)
    const { prompt, model, provider, fallback } = planFor(
      task,
      withProject(await briefed(task, startPrompt(task, place, promptLanguage(), branchOf(project)), project), project),
      project,
    )
    const extras = agentExtras(home, project, task)
    const sessionId = await launchIn(home, { name: task, cwd: place.path, prompt, model, settings: settingsFor(task, project), ...extras })
    if (fallback === null) return { sessionId }
    console.warn(englishOf(noAccountFor(task, fallback, provider)))
    return { sessionId, fallback }
  },
  liveSession: (task) => sessions.find((view) => view.task === task && view.lamp !== 'finished')?.sessionId,
  blocked: (project, task) => launchBlock(account.view, choiceFor(project, task).account),
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
    writes.add('the chain state', saveChainState(db, state, configStore.current.ids))
    hub.broadcast('state', getState())
  },
  journal: (entry) => {
    writes.add(`the launch of ${entry.task}`, appendLaunch(db, entry, configStore.current.ids))
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
  promptLanguage,
  mainBranch: (task) => {
    const project = projectOf(task)
    return project === undefined ? DEFAULT_BRANCH : branchOf(project)
  },
  resume: (task, session) => resumeWith(task, session, resumePrompt(promptLanguage())),
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
    const { prompt, model } = planFor(name, withProject(fixPrompt(report, place, promptLanguage(), branchOf(project)), project), project)
    const extras = agentExtras(home, project, name)
    return launchIn(home, { name, cwd: place.path, prompt, model, settings: settingsFor(name, project), ...extras })
  },
  stop: (session) => stopIn(homeOf(session.account), session),
  finish: async (project, task) => {
    if (!isFixName(task)) archiveClosed(project, task)
    const repo = configStore.current.projects[project]!
    const span = isFixName(task) ? 0 : slotSpan(project)
    let stopped: Notice[]
    let finished: Awaited<ReturnType<typeof finishWorktree>>
    try {
      stopped = await stopTaskSessions(repo, task, Math.max(span, 1))
      const main = branchOf(project)
      finished = await (span > 0 ? finishSlot(runGit, repo, task, span, main) : finishWorktree(runGit, repo, task, main))
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
  refresh: async (project) => refreshers.get(project)?.(),
  log: (message) => console.log(message),
  main: mainCheckDeps({
    repo: (project) => configStore.current.projects[project]!,
    main: branchOf,
    git: runGit,
    watches: (project) => (ciWatches.found ? (ciWatches.byProject.get(project) ?? []) : null),
    settings: (project) => configStore.current.settings[project]?.ci ?? DEFAULT_CI,
    commands: (project) => configStore.current.settings[project]?.check ?? [],
    language: () => configStore.current.language ?? promptLanguage(),
    promptLanguage,
    create: async (task) => (await linkOf(task.project)?.run(async (tracker) => tracker.create?.(task))) ?? null,
    comment: async (task, body) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkOf(project)
      await link?.run(async (tracker) => tracker.comment?.(task, body))
    },
    prepare: (project, task) => places.prepare(project, task),
    place: async (project, task) => (await places.readyAhead(project, task)).path,
    runCheck: (project, task, cwd) => runCheck(configStore.current.settings[project]?.check ?? [], taskRun(task, cwd)),
    afterGreen: (project) => configStore.current.settings[project]?.afterGreen ?? [],
    runAfterGreen: (project, cwd) => runAfterGreen(configStore.current.settings[project]?.afterGreen ?? [], taskRun(project, cwd)),
    now: () => new Date(),
  }),
})

/** Stops the session and resumes it with `prompt`; the page keeps it working, not finished, while it is respawned. */
function resumeWith(task: string, session: HandoffSession, prompt: string): Promise<string> {
  return monitor.holds.during(session.sessionId, async () => {
    const home = homeOf(session.account)
    await stopIn(home, session)
    await daemons.prepare(home)
    const plan = planFor(task, prompt)
    const extras = agentExtras(home, projectOf(task), task)
    return resumeIn(home, session, { name: task, cwd: session.cwd, prompt: plan.prompt, model: plan.model, settings: settingsFor(task), ...extras })
  })
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
 * a page message to a working session whose hooks take mail goes into its mailbox instead (BTN-181).
 */
async function answerSession(
  project: string,
  task: string,
  sessionId: string,
  ask: string | null,
  reply: Omit<Reply, 'files'> & { files: InboxFile[] },
): Promise<void> {
  const { session, midTurn } = dispatcher.answerable(project, task, sessionId, ask, reply.from === 'page' && mailbox.listens(sessionId))
  const question = ask === null ? null : (liveView(task)?.ask ?? null)
  let files: string[]
  try {
    files = await saveInbox(session.workdir, reply.files)
  } catch (error) {
    throw fail('answer.file', { name: reply.files.map((file) => file.name).join(', ') }, { detail: (error as Error).message }, { cause: error })
  }
  const prompt = replyPrompt({ ...reply, files }, question, promptLanguage())
  if (midTurn) {
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
  projectIds: configStore.current.ids,
  config: configStore.view(launchedProjects(launches)),
  chain: {
    active: dispatcher.state.active,
    parallel: configStore.current.parallel,
    queue: dispatcher.state.queue,
    projects: dispatcher.orders(),
    skipped: dispatcher.state.skipped,
    leftovers: dispatcher.state.leftovers,
  },
  tasks: [...tasksByProject.values()].flat(),
  // A finished session's feed is read from its record; the one the chain waits on keeps it: delivering an answer stops it for a while.
  sessions: sessions.map((view) =>
    view.lamp === 'finished' && !dispatcher.state.active.some((chain) => chain.current?.sessionId === view.sessionId) ? { ...view, feed: [] } : view,
  ),
  limits: limits.limits(activeAccount()),
  usage: limits.usage(activeAccount()),
  account: account.view,
  trackers: trackers.views(),
  trackerUrls: {
    default: trackers.setup(configStore.current.tracker)?.issueUrl(null) ?? null,
    projects: Object.fromEntries(Object.keys(configStore.current.projects).map((project) => [project, trackers.setup(configStore.current.trackers[project]!)?.issueUrl(project) ?? null])),
  },
  ci: Object.fromEntries([...ciWatches.byProject].map(([project, watches]) => [project, watches.map((watch) => watch.view)])),
  launches: launchDays(launches, new Date(), LAUNCH_CHART_DAYS),
  taskSessions: taskSessions(launches, sessions, sessionAccount),
  fixes: fixEpisodes(launches).episodes,
  context: configStore.current.context,
  configError: configStore.error ?? listenError,
  packages: packages.view(),
  secrets: secrets.view(),
  language: configStore.current.language,
  unattended: dispatcher.state.unattended,
  trimTools: dispatcher.state.trimTools,
  updates: updatesView(release.version, updates.latest, { ...configStore.current.updates, dismissed: dismissedUpdate ?? null }),
  fallbacks: fallbacksSince(launches, new Date(Date.now() - FALLBACK_TOAST_MS)).map(({ at, task, project, fallback }) => ({
    at,
    task,
    notice: noAccountFor(task, fallback, runSettings(configStore.current, project).provider),
  })),
  mailbox: Object.fromEntries(
    sessions.flatMap((view): [string, SessionMail][] => {
      const mail = mailbox.of(view.sessionId)
      const listens = mailbox.listens(view.sessionId)
      return listens || mail.length > 0 ? [[view.sessionId, { listens, mail }]] : []
    }),
  ),
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
    save: (project, form, base) => {
      if (configStore.current.projects[project] === undefined) throw fail('config.unknownProject', { key: project })
      const moved = form.tracker !== base.tracker || form.trackerProject !== base.trackerProject
      if (moved && launchedProjects(launches).includes(project)) throw fail('config.trackerLocked', { key: project })
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
          env: process.env,
          claudeConfig: () => readJson(homes.configFile(homes.global)),
          timeoutMs: TRACKER_CHECK_MS,
        },
        draft,
      ),
    add: (draft) => {
      configStore.addProject(draft)
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
    dismissUpdate: (version) => {
      dismissedUpdate = version
      writes.add('the dismissed update', setStateValue(db, 'updates.dismissed', version))
      hub.broadcast('state', getState())
    },
    muteUpdates: () => configStore.saveUpdates({ notify: false }),
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
  checkpoint: async (sessionId) => {
    const run = handoffsOf(launches, sessionId)
    if (run === undefined) return undefined
    const { first, source } = await stats.checkpoint(run.project)
    return { ...run, first, source, context: monitor.contextOf(sessionId) ?? null }
  },
  handoffNote: async (sessionId) => {
    if (handoffsOf(launches, sessionId) === undefined) return undefined
    const feed = await inHomes((home) => agentOf(home).feed(home, sessionId, 0))
    return feed !== undefined && noteAtEnd(feed.lines)
  },
  mail: (sessionId, event) => (handoffsOf(launches, sessionId) === undefined ? undefined : mailFor(mailRelay, sessionId, event)),
  mergeCheck: (sessionId) => {
    const run = handoffsOf(launches, sessionId)
    if (run === undefined) return undefined
    const settings = configStore.current.settings[run.project]
    const views = (ciWatches.byProject.get(run.project) ?? []).map((watch) => watch.view)
    const commands = settings === undefined ? [] : mergeCheck(settings.check, settings.ci, views)
    return { commands, branch: branchOf(run.project) }
  },
  tools: async (project) => {
    const repo = configStore.current.projects[project]
    if (repo === undefined) return undefined
    const list = homes.list()
    const view = await readToolsView(project, {
      repo,
      globalDir: homes.global.dir,
      configs: claudeConfigs(),
      accounts: list.filter((home) => !home.global).map(({ key, dir }) => ({ key, dir })),
      homes: list.map((home) => home.dir),
      trim: dispatcher.state.trimTools,
      hidden: configStore.current.hiddenSkills,
      mode: agentOf(homes.find(claudeAccount()) ?? homes.global).mode,
    })
    const received = view.received
    return received === null ? view : { ...view, received: { ...received, account: sessionAccount(received.sessionId, received.at) } }
  },
  tasks: {
    card: async (task) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkOf(project)
      if (link === undefined) return undefined
      return link.run(async (tracker) => {
        if (tracker.card === undefined) return undefined
        const [card, milestones] = await Promise.all([tracker.card(task), tracker.milestones?.(task) ?? null])
        return cardOf(card, rulesOf(project!), tracker.ready !== undefined, milestones)
      })
    },
    file: async (task, file) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkOf(project)
      if (link === undefined) return undefined
      return link.run(async (tracker) => (await tracker.file?.(task, file)) ?? undefined)
    },
    ready: async (task) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkOf(project)
      if (link === undefined) throw fail('task.noTracker', { task })
      const status = await link.run(async (tracker) => tracker.ready?.(task))
      if (status === undefined) throw fail('task.cannotReady', { task })
      if (status === null) throw fail('task.pastBacklog', { task })
      const tasks = tasksByProject.get(project!)
      if (tasks?.some((each) => each.id === task)) {
        const updated = tasks.map((each) => (each.id === task ? { ...each, status } : each))
        tasksByProject.set(project!, updated)
        dispatcher.setTasks(project!, updated)
      }
      hub.broadcast('state', getState())
    },
    // The milestone moves the task in the chain's order: the project is read anew rather than patched.
    moveMilestone: async (task, milestone) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkOf(project)
      if (link === undefined) throw fail('task.noTracker', { task })
      const moved = await link.run(async (tracker) => (tracker.moveMilestone === undefined ? false : (await tracker.moveMilestone(task, milestone), true)))
      if (!moved) throw fail('task.cannotMoveMilestone', { task })
      await refreshers.get(project!)?.()
    },
    refresh: async (project) => {
      const refresh = refreshers.get(project)
      if (refresh === undefined) throw fail('tracker.noProject', { project })
      await refresh()
    },
  },
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

function configuredProject(task: string): string | undefined {
  const project = parseTaskId(task)?.project
  return project !== undefined && Object.hasOwn(configStore.current.projects, project) ? project : undefined
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
  tracker: (project, call) => linkOf(project)?.run(call),
  language: () => configStore.current.language ?? promptLanguage(),
  load: () => postedQuestions,
  save: (posted) => writes.add('the posted questions', saveQuestions(db, posted)),
  answer: (project, task, sessionId, ask, reply) => answerSession(project, task, sessionId, ask, { from: 'tracker', ...reply }),
  log: (message) => console.log(message),
})

setInterval(() => hub.broadcast('ping', { at: new Date().toISOString() }), 15_000).unref()
setInterval(() => void questions.tick(), 15_000).unref()
setInterval(() => settleMail(mailRelay), 15_000).unref()

setInterval(() => dispatcher.check(), LIMIT_CHECK_MS).unref()

const applyCi = () =>
  void ciWatches.apply(configStore.current.projects).then(() => {
    dispatcher.check()
    hub.broadcast('state', getState())
  })
applyCi()
setInterval(() => {
  for (const watch of ciWatches.all()) void watch.tick()
}, CI_TICK_MS).unref()

/** The config's projects changed: renamed keys carry their state, removed ones let their chain go, the rest follows the config. */
function projectsChanged(before: EvenKeelConfig): void {
  const after = configStore.current
  const rename = rekeyed(before.ids, after.ids)
  const renamed = Object.keys(before.ids).filter((key) => rename(key) !== key)
  if (renamed.length > 0) {
    dispatcher.rekey(rename)
    for (const entry of launches) entry.project = rename(entry.project)
    for (const [key, tasks] of [...tasksByProject]) {
      tasksByProject.delete(key)
      tasksByProject.set(rename(key), tasks)
    }
    console.log(`config: renamed ${renamed.map((key) => `${key} to ${rename(key)}`).join(', ')}`)
  }
  for (const key of Object.keys(before.projects).map(rename)) {
    if (Object.hasOwn(after.projects, key)) continue
    dispatcher.forget(key)
    tasksByProject.delete(key)
    console.log(`config: ${key} is gone from the config; its chain is let go, its sessions are left as they are`)
  }
  for (const key of Object.keys(after.projects)) if (!Object.hasOwn(before.projects, key) && !renamed.some((old) => rename(old) === key)) console.log(`config: ${key} joined`)
  trackers.apply(after, process.env)
  if (JSON.stringify(before.projects) !== JSON.stringify(after.projects)) {
    void packages.projectsChanged(rename).catch((error: unknown) => console.warn(`packages: ${(error as Error).message}`))
    applyCi()
  }
}

monitor.start()
void owners.scan()
limits.start()
updates.start()
account.start()
vscode.start()
configStore.watch()
void packages.start()
tally.start()
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

trackers.apply(configStore.current, process.env)

/** `.env` changed: whoever reads the changed variables takes them now (`docs/service.md`). */
async function envChanged(changed: string[]): Promise<void> {
  console.log(`env: ${changed.join(', ')} changed in .env`)
  const targets = envTargets(changed)
  if (targets.trackers.length > 0) trackers.apply(configStore.current, process.env)
  if (targets.ci) ciWatches.tokensChanged()
  if (targets.accounts) {
    homes.setRoots(accountsRoot(process.env), codexAccountsRoot(process.env))
    account.refresh()
    limits.refresh()
    void owners.scan()
  }
  if (targets.guard) applyGuard()
  if (targets.listen) await rebind()
  if (targets.tally) {
    await tally.stop()
    tally = newTally()
    stats.setReader(tally.reader)
    tally.start()
    console.log('tally: the stats database changed, the collector starts anew')
  }
  dispatcher.check()
  hub.broadcast('state', getState())
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

