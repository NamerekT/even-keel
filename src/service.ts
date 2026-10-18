import { createReadStream, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { checkCredit } from './account/credit.js'
import { DaemonRefresh } from './account/daemon.js'
import { AccountHomes, accountsRoot, type AccountHome } from './account/homes.js'
import { checkApiKey } from './account/keycheck.js'
import { accountAt, forgetAccount, loadLedger, markRemoving, nameAccount, noteAccount, saveLedger, type AccountLedger } from './account/ledger.js'
import { accountId, launchBlock, liveSessions, loginBlock, type LoginBlock } from './account/model.js'
import { VsCodeAccount, vscodeSettingsFile } from './account/vscode.js'
import { AccountWatcher } from './account/watcher.js'
import { AGENTS } from './agent/adapters.js'
import type { Agent, SessionHandle, SessionStart } from './agent/contract.js'
import { sessionBase } from './agent/env.js'
import { updateMarketplace } from './claude/cli.js'
import { CLAUDE } from './claude/name.js'
import { Dispatcher, type LaunchEntry } from './chain/dispatcher.js'
import { fallbacksSince, fixEpisodes, handoffsOf, launchDays, launchedProjects, taskSessions } from './chain/launches.js'
import { fixName, fixTaskOf, isFixName } from './chain/fix.js'
import { fixPrompt, noteOf, resumePrompt, startPrompt, withBrief, withProjectPrompt, withTracker, withUnattended, type HandoffSession, type TrackerPlace } from './chain/relay.js'
import { launchLine } from './chain/log.js'
import { mainCheckDeps, mergeCheck } from './chain/mainci.js'
import { TaskPlaces } from './chain/places.js'
import { readNote, saveSnapshot, snapshotReason } from './chain/snapshots.js'
import { appendLaunch, loadChainState, loadQuestions, readLaunches, saveChainState, saveQuestions } from './chain/store.js'
import { CI_TOKENS, ciSource, projectTargets } from './ci/adapters.js'
import { CiWatch } from './ci/watcher.js'
import { ConfigFile } from './config-file.js'
import { DEFAULT_BRANCH, DEFAULT_CI, listenOf, mcpPortOf, poolEntries, projectsByAccount, runSettings } from './config.js'
import { EventHub } from './events.js'
import { runGit } from './git/run.js'
import { finishSlot, prepareSlot, slotPaths, type SlotUse } from './git/slot.js'
import { ensureIgnored, finishWorktree, prepareWorktree, requireBranch, taskPlace } from './git/worktree.js'
import { exhaustedReset, limitResetAfter } from './limits/model.js'
import { LimitsWatcher } from './limits/watcher.js'
import { englishOf, fail, notice, noticeOf, type Notice } from './notice/notice.js'
import { guardHosts, guardToken } from './guard.js'
import { readJson } from './packages/plugins.js'
import { Packages } from './packages/service.js'
import { createEvenKeelServer } from './server.js'
import { replyPrompt, type Reply } from './sessions/ask.js'
import { inboxImage, saveInbox, type InboxFile } from './sessions/inbox.js'
import { isLive, turnStatus, type AgentEntry } from './sessions/agents.js'
import { launchPlan, runChoice, type LaunchPlan, type RunChoice } from './sessions/launch.js'
import { runAfterGreen, runBeforeStart, runCheck, systemShell, type SetupRun } from './sessions/setup.js'
import { SessionMonitor } from './sessions/monitor.js'
import { noteAtEnd } from './sessions/note.js'
import { TranscriptOwners } from './sessions/owners.js'
import { ChatTitles } from './sessions/title.js'
import { TranscriptWatch } from './sessions/watch.js'
import { configPath, root, stateDirOf } from './locations.js'
import { isInside } from './paths.js'
import { slotOccupants } from './sessions/occupants.js'
import { locateWorktree } from './sessions/place.js'
import type { EvenKeelState, SessionView } from './state.js'
import { StatsReader } from './stats/reader.js'
import { TallyService } from './stats/tally.js'
import { chainSettings, readToolsView } from './tools/panel.js'
import { ADAPTERS, trackerKeyRules } from './tracker/adapters.js'
import { cardOf } from './tracker/card.js'
import type { TrackerView } from './tracker/health.js'
import type { TrackerLink } from './tracker/link.js'
import { parseTaskId, runLabelText, type Task } from './tracker/model.js'
import { TrackerQuestions, type AskingSession } from './tracker/questions.js'
import type { TrackerSetup } from './tracker/source.js'
import { startTracker } from './tracker/start.js'
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
const TALLY_INTERVAL_MS = 5 * 60_000
const TALLY_FIRST_DELAY_MS = 15_000
const SHUTDOWN_MS = 15_000
const CI_TICK_MS = 5_000
const CI_TIMEOUT_MS = 15_000
const UPDATE_POLL_MS = 12 * 60 * 60_000
const PLUGIN_UPDATE_TIMEOUT_MS = 2 * 60_000

const configFile = new ConfigFile({
  file: configPath(),
  intervalMs: CONFIG_POLL_MS,
  warn: (message) => console.warn(message),
  onChange: () => {
    for (const [project, tasks] of tasksByProject) dispatcher.setTasks(project, tasks)
    dispatcher.check()
    updates.configChanged()
    hub.broadcast('state', getState())
  },
})
const config = configFile.current
const { listen, token, mcpPort } = (() => {
  try {
    const listen = listenOf(process.env)
    return { listen, token: guardToken(process.env, listen.host), mcpPort: mcpPortOf(process.env) }
  } catch (error) {
    console.error(englishOf(noticeOf(error)))
    process.exit(1)
  }
})()
const branchOf = (project: string) => configFile.current.settings[project]?.branch ?? DEFAULT_BRANCH
const rulesOf = (project: string) => configFile.current.rules[project]!
const stateDir = stateDirOf()
mkdirSync(stateDir, { recursive: true })
const chainFile = join(stateDir, 'chain.json')
const launchesFile = join(stateDir, 'launches.jsonl')
const handoffsDir = join(stateDir, 'handoffs')
const limitsFile = join(stateDir, 'rate-limits.json')
const accountFile = join(stateDir, 'account.json')
const trackerNames = [...new Set([config.tracker, ...Object.values(config.trackers)])]
const trackerProjects = (name: string) => Object.keys(config.projects).filter((project) => config.trackers[project] === name)
const trackerNamesOf = (name: string) =>
  Object.fromEntries(trackerProjects(name).flatMap((project) => (project in config.trackerProjects ? [[project, config.trackerProjects[project]!]] : [])))
const setups = new Map<string, TrackerSetup | undefined>(trackerNames.map((name) => [name, ADAPTERS[name]!.setup(process.env, trackerNamesOf(name))]))
const trackers = new Map<string, TrackerView>(
  trackerNames
    .filter((name) => trackerProjects(name).length > 0)
    .map((name) => [
      name,
      { name, title: ADAPTERS[name]!.title, projects: trackerProjects(name), ready: false, health: { state: 'off', lastOkAt: null, error: null }, readAt: {} },
    ]),
)
const links = new Map<string, TrackerLink>()
const hub = new EventHub()
const transcriptWatch = new TranscriptWatch(
  (sessionId) => hub.signal('transcript', { sessionId }),
  (error) => console.error(`sessions: watching a transcript: ${error instanceof Error ? error.message : String(error)}`),
)
const homes = new AccountHomes(process.env, accountsRoot(process.env))
/** The shared pool's Claude entry: whose `.claude.json` and tools the Claude-only checks read. */
const claudeAccount = () => configFile.current.accounts[CLAUDE]!
/** `.claude.json` files sessions read: the global one and the shared Claude account's. */
const claudeConfigs = () =>
  [...new Set([homes.global, homes.find(claudeAccount())].flatMap((home) => (home === undefined ? [] : [homes.configFile(home)])))]
const packages: Packages = new Packages({
  file: join(stateDir, 'packages.json'),
  cache: join(stateDir, 'packages'),
  envFile: join(root, '.env'),
  ids: config.ids,
  repos: config.projects,
  globalDir: homes.global.dir,
  claudeConfigs,
  rules: trackerKeyRules(),
  trackerServer: (project) => (configFile.current.briefs[project] ? undefined : ADAPTERS[config.trackers[project]!]!.mcpServer),
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
    adapter.setup({ env: sessionBase(process.env, packages.keyNames()), timeoutMs: AGENT_TIMEOUT_MS, workDir: stateDir }),
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
const ciWatches = new Map<string, CiWatch[]>()
/** Every project's remotes are read and its CIs are in `ciWatches`. */
let ciFound = false
let sessions: SessionView[] = []
let agents: AgentEntry[] = []
let agentsRead = false
const launches: LaunchEntry[] = readLaunches(launchesFile, config.ids)
const tally = new TallyService({
  root,
  stateDir,
  env: process.env,
  intervalMs: TALLY_INTERVAL_MS,
  firstDelayMs: TALLY_FIRST_DELAY_MS,
  evenKeelUrl: `http://${['0.0.0.0', '::'].includes(listen.host) ? '127.0.0.1' : listen.host}:${listen.port}`,
  log: (message) => console.log(message),
})
const stats = new StatsReader(tally.reader, config.projects, () => configFile.current.stats)
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
  enabled: () => configFile.current.updates.check,
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
    configFile.saveActive(homes.find(key)?.agent ?? CLAUDE, key)
    hub.broadcast('state', getState())
    dispatcher.check()
  },
  forget: (key) => saveAccounts(forgetAccount(ledger, key)),
  nameOf: (key) => ledger.accounts[key]?.name ?? null,
  name: (key, name) => saveAccounts(nameAccount(ledger, key, name)),
  loginBlock: (): LoginBlock | null => loginBlock(dispatcher.state.active, agents, activeAccount()),
  sessionsIn: (key) => liveSessions(agents, key),
  projectsOn: (key) => projectsByAccount(configFile.current, Object.keys(config.projects))[key] ?? [],
  pool: () => poolEntries(configFile.current, Object.keys(config.projects)),
  sessionsKnown: () => agentsRead,
  removing: (key) => ledger.removing.includes(key),
  markRemoving: (key, on) => saveAccounts(markRemoving(ledger, key, on)),
  configPending: (key) => daemons.pending(key),
  limits: (key) => limits.limits(key),
  usage: (key) => limits.usage(key),
  checkKey: (key) => checkApiKey(key, KEY_CHECK_TIMEOUT_MS),
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
  projectKeys: () => Object.keys(config.projects),
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
  runChoice(task === undefined ? undefined : knownTask(task), runSettings(configFile.current, project), hasAccount)

const planFor = (task: string, prompt: string, project = projectOf(task)): LaunchPlan => {
  const full = withUnattended(prompt, dispatcher.state.unattended, promptLanguage())
  const plan = launchPlan(knownTask(task), full, runSettings(configFile.current, project), configFile.current.modelPrompts, hasAccount)
  if (plan.warning !== null) console.warn(plan.warning)
  return plan
}

/** What a session also gets: the project's packages, and the global execution mode for an agent other than Claude Code. */
const agentExtras = (home: AccountHome, project: string | undefined, task: string): Pick<SessionStart, 'bypassSandbox' | 'mcp' | 'plugins'> => ({
  ...(home.agent !== CLAUDE && configFile.current.execution[home.agent] === 'bypass' ? { bypassSandbox: true } : {}),
  ...(project === undefined ? {} : packages.startOf(project, task)),
})

const noAccountFor = (task: string, fallback: string, provider: string) =>
  notice('chain.noAccountFor', {
    task,
    label: runLabelText({ provider: fallback, model: null }),
    provider: runLabelText({ provider, model: null }),
  })

/** The account holding the Even Keel role, the one the header shows: the shared provider's entry of the shared pool. */
const activeAccount = () => configFile.current.accounts[configFile.current.provider]!

const promptLanguage = () => configFile.current.promptLanguage

const trackerPlace = (project: string): TrackerPlace | null => {
  const name = config.trackers[project]!
  const place = config.trackerProjects[project]
  return place === undefined ? null : { title: ADAPTERS[name]!.title, project: place }
}

const briefed = async (task: string, given: string, project = projectOf(task)): Promise<string> => {
  if (project === undefined) return given
  const prompt = withTracker(given, trackerPlace(project), promptLanguage())
  if (!configFile.current.briefs[project]) return prompt
  const link = links.get(config.trackers[project]!)
  return link === undefined ? prompt : withBrief(prompt, await link.run(async (tracker) => tracker.brief?.(task)), promptLanguage())
}

/** The project's own prompt, for a new session only: a resumed one already has it. */
const withProject = (prompt: string, project: string | undefined): string =>
  withProjectPrompt(prompt, project === undefined ? null : (configFile.current.settings[project]?.prompt ?? null), promptLanguage())

/** The settings files whose `enabledPlugins` a chain session would read. */
const pluginSettings = (repo: string) =>
  [join(homes.global.dir, 'settings.json'), join(repo, '.claude', 'settings.json'), join(repo, '.claude', 'settings.local.json')].map(readJson)

const settingsFor = (task: string, project = projectOf(task)): string | undefined =>
  project === undefined
    ? undefined
    : chainSettings(
        config.projects[project]!,
        packages.otherPlugins(project, task, pluginSettings(config.projects[project]!)),
        dispatcher.state.trimTools,
        configFile.current.hiddenSkills,
        homes.global.dir,
        configFile.current.cacheTtl,
      )

function projectOf(task: string): string | undefined {
  for (const [project, tasks] of tasksByProject) if (tasks.some((each) => each.id === task)) return project
  const fixed = isFixName(task) ? Object.keys(config.projects).find((project) => fixName(project) === fixTaskOf(task)) : undefined
  return fixed ?? dispatcher.state.active.find((chain) => chain.current?.task === task)?.project
}

const places = new TaskPlaces({
  git: runGit,
  main: branchOf,
  place: async (project, task, { ahead = false, at } = {}) => {
    const repo = config.projects[project]!
    const main = branchOf(project)
    await requireBranch(runGit, repo, project, main)
    await ensureIgnored(runGit, repo)
    const count = config.slots[project]
    if (count === undefined || isFixName(task)) return prepareWorktree(runGit, repo, task, main, ahead)
    const pool = { count, main, ahead, occupancy: (path: string) => slotUse(path, task), vacate: (path: string) => vacateSlot(path, task) }
    return prepareSlot(runGit, repo, task, at === undefined ? pool : { ...pool, at })
  },
  setUp: (project, task, path) => runBeforeStart(configFile.current.settings[project]?.beforeStart ?? [], taskRun(task, path)),
})

function taskRun(task: string, cwd: string): SetupRun {
  return { task, cwd, shell: systemShell(() => envOf(homeOf(claudeAccount()))), log: (line) => console.log(line) }
}

const dispatcher = new Dispatcher(loadChainState(chainFile, config.ids), {
  projects: Object.keys(config.projects),
  parallel: () => configFile.current.parallel,
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
  asked: (task) => liveView(task)?.ask?.id ?? null,
  save: (state) => {
    saveChainState(chainFile, state, config.ids)
    hub.broadcast('state', getState())
  },
  journal: (entry) => {
    appendLaunch(launchesFile, entry, config.ids)
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
    try {
      saveSnapshot(handoffsDir, snapshot)
    } catch (error) {
      console.warn(`chain: handoff snapshot of ${task} not saved: ${(error as Error).message}`)
    }
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
    const repo = config.projects[project]!
    const count = isFixName(task) ? undefined : config.slots[project]
    let stopped: Notice[]
    let finished: Awaited<ReturnType<typeof finishWorktree>>
    try {
      stopped = await stopTaskSessions(repo, task, count ?? 1)
      const main = branchOf(project)
      finished = await (count !== undefined ? finishSlot(runGit, repo, task, count, main) : finishWorktree(runGit, repo, task, main))
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
    repo: (project) => config.projects[project]!,
    main: branchOf,
    git: runGit,
    watches: (project) => (ciFound ? (ciWatches.get(project) ?? []) : null),
    settings: (project) => configFile.current.settings[project]?.ci ?? DEFAULT_CI,
    commands: (project) => configFile.current.settings[project]?.check ?? [],
    language: () => configFile.current.language ?? promptLanguage(),
    promptLanguage,
    create: async (task) => (await links.get(config.trackers[task.project]!)?.run(async (tracker) => tracker.create?.(task))) ?? null,
    comment: async (task, body) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : links.get(config.trackers[project]!)
      await link?.run(async (tracker) => tracker.comment?.(task, body))
    },
    prepare: (project, task) => places.prepare(project, task),
    place: async (project, task) => (await places.readyAhead(project, task)).path,
    runCheck: (project, task, cwd) => runCheck(configFile.current.settings[project]?.check ?? [], taskRun(task, cwd)),
    afterGreen: (project) => configFile.current.settings[project]?.afterGreen ?? [],
    runAfterGreen: (project, cwd) => runAfterGreen(configFile.current.settings[project]?.afterGreen ?? [], taskRun(project, cwd)),
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

/** Saves the files into the task's folder and resumes the waiting session with the reply (invariant 1, exception 6). */
async function answerSession(
  project: string,
  task: string,
  sessionId: string,
  ask: string | null,
  reply: Omit<Reply, 'files'> & { files: InboxFile[] },
): Promise<void> {
  const { session } = dispatcher.answerable(project, task, sessionId, ask)
  const question = ask === null ? null : (liveView(task)?.ask ?? null)
  let files: string[]
  try {
    files = await saveInbox(session.workdir, reply.files)
  } catch (error) {
    throw fail('answer.file', { name: reply.files.map((file) => file.name).join(', ') }, { detail: (error as Error).message }, { cause: error })
  }
  const prompt = replyPrompt({ ...reply, files }, question, promptLanguage())
  dispatcher.answer(project, task, sessionId, ask, prompt)
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

const getState = (): EvenKeelState => ({
  startedAt,
  projects: Object.keys(config.projects),
  projectIds: config.ids,
  config: configFile.view(launchedProjects(launches)),
  chain: {
    active: dispatcher.state.active,
    parallel: configFile.current.parallel,
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
  trackers: [...trackers.values()],
  trackerUrls: {
    default: setups.get(config.tracker)?.issueUrl(null) ?? null,
    projects: Object.fromEntries(Object.keys(config.projects).map((project) => [project, setups.get(config.trackers[project]!)?.issueUrl(project) ?? null])),
  },
  ci: Object.fromEntries([...ciWatches].map(([project, watches]) => [project, watches.map((watch) => watch.view)])),
  launches: launchDays(launches, new Date(), LAUNCH_CHART_DAYS),
  taskSessions: taskSessions(launches, sessions, sessionAccount),
  fixes: fixEpisodes(launches).episodes,
  context: config.context,
  configError: configFile.error,
  packages: packages.view(),
  language: configFile.current.language,
  unattended: dispatcher.state.unattended,
  trimTools: dispatcher.state.trimTools,
  updates: updatesView(release.version, updates.latest, configFile.current.updates),
  fallbacks: fallbacksSince(launches, new Date(Date.now() - FALLBACK_TOAST_MS)).map(({ at, task, project, fallback }) => ({
    at,
    task,
    notice: noAccountFor(task, fallback, runSettings(configFile.current, project).provider),
  })),
})

const server = createEvenKeelServer({
  hub,
  publicDir: join(root, 'dist', 'web'),
  getState,
  control: dispatcher,
  account,
  sessions: {
    answer: ({ project, task, sessionId, ask, answers, text, files }) => answerSession(project, task, sessionId, ask, { from: 'page', answers, text, files }),
  },
  settings: {
    save: (project, form, base) => {
      if (config.projects[project] === undefined) throw fail('config.unknownProject', { key: project })
      const moved = form.tracker !== base.tracker || form.trackerProject !== base.trackerProject
      if (moved && launchedProjects(launches).includes(project)) throw fail('config.trackerLocked', { key: project })
      configFile.saveProject(project, form, base)
      console.log(`page: the settings of ${project} are written to the config`)
    },
    saveShared: (form, base) => {
      configFile.saveShared(form, base)
      console.log('page: the shared settings are written to the config')
    },
    dismissUpdate: (version) => configFile.saveUpdates({ dismissed: version }),
    muteUpdates: () => configFile.saveUpdates({ notify: false }),
  },
  packages,
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
  mergeCheck: (sessionId) => {
    const run = handoffsOf(launches, sessionId)
    if (run === undefined) return undefined
    const settings = configFile.current.settings[run.project]
    const views = (ciWatches.get(run.project) ?? []).map((watch) => watch.view)
    const commands = settings === undefined ? [] : mergeCheck(settings.check, settings.ci, views)
    return { commands, branch: branchOf(run.project) }
  },
  tools: async (project) => {
    const repo = config.projects[project]
    if (repo === undefined) return undefined
    const list = homes.list()
    const view = await readToolsView(project, {
      repo,
      globalDir: homes.global.dir,
      configs: claudeConfigs(),
      accounts: list.filter((home) => !home.global).map(({ key, dir }) => ({ key, dir })),
      homes: list.map((home) => home.dir),
      trim: dispatcher.state.trimTools,
      hidden: configFile.current.hiddenSkills,
      mode: agentOf(homes.find(claudeAccount()) ?? homes.global).mode,
    })
    const received = view.received
    return received === null ? view : { ...view, received: { ...received, account: sessionAccount(received.sessionId, received.at) } }
  },
  tasks: {
    card: async (task) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : links.get(config.trackers[project]!)
      if (link === undefined) return undefined
      return link.run(async (tracker) => {
        if (tracker.card === undefined) return undefined
        const [card, milestones] = await Promise.all([tracker.card(task), tracker.milestones?.(task) ?? null])
        return cardOf(card, rulesOf(project!), tracker.ready !== undefined, milestones)
      })
    },
    file: async (task, file) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : links.get(config.trackers[project]!)
      if (link === undefined) return undefined
      return link.run(async (tracker) => (await tracker.file?.(task, file)) ?? undefined)
    },
    ready: async (task) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : links.get(config.trackers[project]!)
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
      const link = project === undefined ? undefined : links.get(config.trackers[project]!)
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
  guard: () => ({ hosts: guardHosts(listen.host, configFile.current.allowedHosts), token }),
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
  return project !== undefined && Object.hasOwn(config.projects, project) ? project : undefined
}

const questionsFile = join(stateDir, 'questions.json')
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
  tracker: (project, call) => links.get(config.trackers[project]!)?.run(call),
  language: () => configFile.current.language ?? promptLanguage(),
  load: () => loadQuestions(questionsFile),
  save: (posted) => saveQuestions(questionsFile, posted),
  answer: (project, task, sessionId, ask, reply) => answerSession(project, task, sessionId, ask, { from: 'tracker', ...reply }),
  log: (message) => console.log(message),
})

setInterval(() => hub.broadcast('ping', { at: new Date().toISOString() }), 15_000).unref()
setInterval(() => void questions.tick(), 15_000).unref()

setInterval(() => dispatcher.check(), LIMIT_CHECK_MS).unref()

void (async () => {
  for (const [project, repo] of Object.entries(config.projects)) {
    const targets = await projectTargets(runGit, repo)
    if (targets.length === 0) continue
    ciWatches.set(
      project,
      targets.map(
        (target) =>
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
      ),
    )
    console.log(`ci: ${project} watches ${targets.map((target) => `${target.kind} on ${target.remote}`).join(', ')}`)
  }
  ciFound = true
  dispatcher.check()
  setInterval(() => {
    for (const watch of [...ciWatches.values()].flat()) void watch.tick()
  }, CI_TICK_MS).unref()
  for (const watch of [...ciWatches.values()].flat()) void watch.tick()
})()

monitor.start()
void owners.scan()
limits.start()
updates.start()
account.start()
vscode.start()
configFile.watch()
void packages.start()
tally.start()

// The local Tally database closes cleanly on a stop signal; the Windows service host kills the process instead,
// and PGlite recovers from its WAL on the next start.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    setTimeout(() => process.exit(0), SHUTDOWN_MS).unref()
    void tally.stop().finally(() => process.exit(0))
  })
}

server.listen(listen.port, listen.host, () => {
  console.log(`even-keel listening on http://${listen.host}:${listen.port}`)
})

for (const view of trackers.values()) {
  const setup = setups.get(view.name)
  if (setup === undefined) console.log(`${view.name}: ${ADAPTERS[view.name]!.variables.join(', ')} not set, tracker is off`)
  else {
    startTracker(view, setup, {
      repos: config.projects,
      rulesOf,
      links,
      tasksByProject,
      launches,
      dispatcher,
      fillsMilestone: (project) => configFile.current.settings[project]?.fillMilestone ?? false,
      mainBranch: branchOf,
      broadcast: () => hub.broadcast('state', getState()),
      refreshers,
    })
  }
}

