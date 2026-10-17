import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { checkCredit } from './account/credit.js'
import { DaemonRefresh } from './account/daemon.js'
import { AccountHomes, accountsRoot, type AccountHome } from './account/homes.js'
import { checkApiKey } from './account/keycheck.js'
import { accountAt, activate, forgetAccount, loadLedger, markRemoving, nameAccount, noteAccount, saveLedger, type AccountLedger } from './account/ledger.js'
import { accountId, launchBlock, liveSessions, loginBlock, type LoginBlock } from './account/model.js'
import { VsCodeAccount, vscodeSettingsFile } from './account/vscode.js'
import { AccountWatcher } from './account/watcher.js'
import { AGENTS } from './agent/adapters.js'
import type { Agent, SessionHandle, SessionStart } from './agent/contract.js'
import { sessionBase } from './agent/env.js'
import { readTrackerServer } from './agent/tracker.js'
import { CODEX_ACCOUNT } from './account/model.js'
import { CLAUDE } from './claude/name.js'
import { CODEX } from './codex/name.js'
import { Dispatcher, type LaunchEntry } from './chain/dispatcher.js'
import { fixEpisodes, handoffsOf, launchDays, launchedProjects, taskSessions } from './chain/launches.js'
import { fixName, fixTaskOf, isFixName } from './chain/fix.js'
import { fixPrompt, noteOf, resumePrompt, startPrompt, withBrief, withProjectPrompt, withTracker, withUnattended, type TrackerPlace } from './chain/relay.js'
import { launchLine } from './chain/log.js'
import { mainCheckDeps, mergeCheck } from './chain/mainci.js'
import { TaskPlaces } from './chain/places.js'
import { readNote, saveSnapshot, snapshotReason } from './chain/snapshots.js'
import { appendLaunch, loadChainState, loadQuestions, readLaunches, saveChainState, saveQuestions } from './chain/store.js'
import { CI_TOKENS, ciSource, projectTargets } from './ci/adapters.js'
import { CiWatch } from './ci/watcher.js'
import { ConfigFile } from './config-file.js'
import { DEFAULT_AGENT, DEFAULT_BRANCH, DEFAULT_CI, listenOf } from './config.js'
import { EventHub } from './events.js'
import { runGit } from './git/run.js'
import { finishSlot, prepareSlot, slotPaths, type SlotUse } from './git/slot.js'
import { ensureIgnored, finishWorktree, prepareWorktree, requireBranch, taskPlace } from './git/worktree.js'
import { exhaustedReset, limitResetAfter } from './limits/model.js'
import { LimitsWatcher } from './limits/watcher.js'
import { englishOf, fail, notice, noticeOf, type Notice } from './notice/notice.js'
import { guardHosts, guardToken } from './guard.js'
import { createEvenKeelServer } from './server.js'
import { replyPrompt, type Reply } from './sessions/ask.js'
import { saveInbox, type InboxFile } from './sessions/inbox.js'
import { isLive, turnStatus, type AgentEntry } from './sessions/agents.js'
import { agentOfTask, launchPlan, type LaunchPlan } from './sessions/launch.js'
import { runAfterGreen, runBeforeStart, runCheck, systemShell, type SetupRun } from './sessions/setup.js'
import { SessionMonitor } from './sessions/monitor.js'
import { TranscriptOwners } from './sessions/owners.js'
import { ChatTitles } from './sessions/title.js'
import { configPath, root, stateDirOf } from './locations.js'
import { isInside } from './paths.js'
import { slotOccupants } from './sessions/occupants.js'
import { locateWorktree } from './sessions/place.js'
import type { EvenKeelState, SessionView } from './state.js'
import { StatsReader } from './stats/reader.js'
import { TallyService } from './stats/tally.js'
import { chainSettings, readToolsView } from './tools/panel.js'
import { ADAPTERS } from './tracker/adapters.js'
import { cardOf } from './tracker/card.js'
import { McpCheck, readFailures, readMcpSources } from './tracker/mcp.js'
import type { TrackerView } from './tracker/health.js'
import type { TrackerLink } from './tracker/link.js'
import { parseTaskId, type Task } from './tracker/model.js'
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

const configFile = new ConfigFile({
  file: configPath(),
  intervalMs: CONFIG_POLL_MS,
  warn: (message) => console.warn(message),
  onChange: () => {
    for (const [project, tasks] of tasksByProject) dispatcher.setTasks(project, tasks)
    dispatcher.check()
    mcp.run()
    updates.configChanged()
    hub.broadcast('state', getState())
  },
})
const config = configFile.current
const { listen, token } = (() => {
  try {
    const listen = listenOf(process.env)
    return { listen, token: guardToken(process.env, listen.host) }
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
      { name, title: ADAPTERS[name]!.title, projects: trackerProjects(name), ready: false, health: { state: 'off', lastOkAt: null, error: null } },
    ]),
)
const links = new Map<string, TrackerLink>()
const hub = new EventHub()
const homes = new AccountHomes(process.env, accountsRoot(process.env))
const runtimes = new Map<string, Agent>(
  Object.entries(AGENTS).map(([name, adapter]) => [name, adapter.setup({ env: sessionBase(process.env), timeoutMs: AGENT_TIMEOUT_MS, workDir: stateDir })]),
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
  active: () => ledger.active,
  activate: (key) => {
    saveAccounts(activate(ledger, key))
    hub.broadcast('state', getState())
    dispatcher.check()
  },
  forget: (key) => saveAccounts(forgetAccount(ledger, key)),
  nameOf: (key) => ledger.accounts[key]?.name ?? null,
  name: (key, name) => saveAccounts(nameAccount(ledger, key, name)),
  loginBlock: (): LoginBlock | null => loginBlock(dispatcher.state.active, agents, ledger.active),
  sessionsIn: (key) => liveSessions(agents, key),
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
const projectAgent = (project: string | undefined) => (project === undefined ? DEFAULT_AGENT : (configFile.current.settings[project]?.agent ?? DEFAULT_AGENT))
/** The agent a new session of the task (or of the fix session `task`) starts on. */
const agentFor = (project: string | undefined, task?: string) => agentOfTask(task === undefined ? undefined : knownTask(task), projectAgent(project))

const planFor = (task: string, prompt: string, project = projectOf(task)): LaunchPlan => {
  const full = withUnattended(prompt, dispatcher.state.unattended, promptLanguage())
  const plan = launchPlan(knownTask(task), full, configFile.current.model, configFile.current.modelPrompts, projectAgent(project))
  if (plan.warning !== null) console.warn(plan.warning)
  return plan
}

/** The folder a new session starts in: Codex has its one folder, Claude sessions start in the active account. */
const startHomeKey = (agent: string) => (agent === CODEX ? CODEX_ACCOUNT : ledger.active)

/**
 * What a session of an agent without Claude Code's plugins and model labels also gets: the project's model, its bypass
 * of the sandbox and the tracker's server.
 */
const agentExtras = (home: AccountHome, project: string | undefined): Pick<SessionStart, 'modelName' | 'bypassSandbox' | 'tracker'> => {
  if (home.agent === CLAUDE || project === undefined) return {}
  const adapter = ADAPTERS[config.trackers[project]!]!
  const tracker = adapter.mcpServer === undefined ? undefined : readTrackerServer(root, adapter.mcpServer, adapter.variables, homes.global.dir, process.env)
  const settings = configFile.current.settings[project]
  const modelName = settings?.codexModel ?? undefined
  return {
    ...(modelName === undefined ? {} : { modelName }),
    ...(settings?.codexBypassSandbox === true ? { bypassSandbox: true } : {}),
    ...(tracker === undefined ? {} : { tracker }),
  }
}

const promptLanguage = () => configFile.current.promptLanguage

const trackerPlace = (project: string): TrackerPlace | null => {
  const name = config.trackers[project]!
  const place = config.trackerProjects[project]
  return place === undefined ? null : { title: ADAPTERS[name]!.title, project: place }
}

const briefed = async (task: string, given: string, project = projectOf(task)): Promise<string> => {
  if (project === undefined) return given
  const prompt = withTracker(given, trackerPlace(project), promptLanguage())
  if (!configFile.current.briefs[project]) {
    mcp.run()
    return prompt
  }
  const link = links.get(config.trackers[project]!)
  return link === undefined ? prompt : withBrief(prompt, await link.run(async (tracker) => tracker.brief?.(task)), promptLanguage())
}

/** The project's own prompt, for a new session only: a resumed one already has it. */
const withProject = (prompt: string, project: string | undefined): string =>
  withProjectPrompt(prompt, project === undefined ? null : (configFile.current.settings[project]?.prompt ?? null), promptLanguage())

/** `.claude.json` files sessions read: the global one and the active account's. */
const claudeConfigs = () =>
  [...new Set([homes.global, homes.find(ledger.active)].flatMap((home) => (home === undefined ? [] : [homes.configFile(home)])))]

const mcp = new McpCheck({
  targets: () =>
    Object.entries(config.projects).flatMap(([project, repo]) => {
      const server = ADAPTERS[config.trackers[project]!]!.mcpServer
      return server === undefined ? [] : [{ project, repo, server, brief: configFile.current.briefs[project] === true }]
    }),
  read: (repo) =>
    readMcpSources(repo, { claudeDir: homes.global.dir, configs: claudeConfigs() }),
  failures: () => {
    const home = homes.find(ledger.active)
    return home === undefined ? {} : readFailures(home.dir)
  },
  now: () => Date.now(),
  warn: (line) => console.warn(line),
  onChange: () => hub.broadcast('state', getState()),
})

const settingsFor = (task: string, cwd: string, project = projectOf(task)): string | undefined =>
  project === undefined
    ? undefined
    : chainSettings(
        config.projects[project]!,
        cwd,
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
  place: async (project, task) => {
    const repo = config.projects[project]!
    const main = branchOf(project)
    await requireBranch(runGit, repo, project, main)
    await ensureIgnored(runGit, repo)
    const count = config.slots[project]
    if (count === undefined || isFixName(task)) return prepareWorktree(runGit, repo, task, main)
    return prepareSlot(runGit, repo, task, { count, main, occupancy: (path) => slotUse(path, task), vacate: (path) => vacateSlot(path, task) })
  },
  setUp: (project, task, path) => runBeforeStart(configFile.current.settings[project]?.beforeStart ?? [], taskRun(task, path)),
})

function taskRun(task: string, cwd: string): SetupRun {
  return { task, cwd, shell: systemShell(() => envOf(homeOf(ledger.active))), log: (line) => console.log(line) }
}

const dispatcher = new Dispatcher(loadChainState(chainFile, config.ids), {
  projects: Object.keys(config.projects),
  parallel: () => configFile.current.parallel,
  rules: rulesOf,
  launch: async (project, task) => {
    const home = homeOf(startHomeKey(agentFor(project, task)))
    await daemons.prepare(home)
    const place = await places.ready(project, task)
    const { prompt, model } = planFor(task, withProject(await briefed(task, startPrompt(task, place, promptLanguage(), branchOf(project)), project), project), project)
    return launchIn(home, { name: task, cwd: place.path, prompt, model, settings: settingsFor(task, place.path, project), ...agentExtras(home, project) })
  },
  liveSession: (task) => sessions.find((view) => view.task === task && view.lamp !== 'finished')?.sessionId,
  blocked: (project, task) => launchBlock(account.view, startHomeKey(agentFor(project, task))),
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
  account: (project, task) => accountNow(startHomeKey(agentFor(project, task))),
  accountAt: (key, at) => accountId(key, accountAt(ledger, key, at)),
  limitReset: (project, task) => exhaustedReset(limits.limits(startHomeKey(agentFor(project, task)))),
  limitResetAfter: (key, at) => (account.apiKey(key) ? account.creditBackAfter(key, at) : limitResetAfter(limits.limits(key), at)),
  mcpFailed: (project) => {
    mcp.run()
    return mcp.failed.find((each) => each.project === project)?.until ?? null
  },
  promptLanguage,
  mainBranch: (task) => {
    const project = projectOf(task)
    return project === undefined ? DEFAULT_BRANCH : branchOf(project)
  },
  resume: async (task, session) => {
    const home = homeOf(session.account)
    await stopIn(home, session)
    await daemons.prepare(home)
    const plan = planFor(task, resumePrompt(promptLanguage()))
    const start = { name: task, cwd: session.cwd, prompt: plan.prompt, model: plan.model, settings: settingsFor(task, session.cwd) }
    return resumeIn(home, session, { ...start, ...agentExtras(home, projectOf(task)) })
  },
  reply: async (task, session, prompt) => {
    const home = homeOf(session.account)
    await stopIn(home, session)
    await daemons.prepare(home)
    const plan = planFor(task, prompt)
    const start = { name: task, cwd: session.cwd, prompt: plan.prompt, model: plan.model, settings: settingsFor(task, session.cwd) }
    return resumeIn(home, session, { ...start, ...agentExtras(home, projectOf(task)) })
  },
  relay: async (task, session, handoff, reason) => {
    const previous = homes.find(session.account)
    if (previous !== undefined) await stopIn(previous, session)
    const project = projectOf(task)
    const home = homeOf(startHomeKey(agentFor(project, task)))
    await daemons.prepare(home)
    const told = isFixName(task) ? handoff : await briefed(task, handoff)
    const { prompt, model } = planFor(task, withProject(told, project), project)
    const notePath = noteOf(session)
    const note = await readNote(notePath)
    const at = new Date().toISOString()
    const start = { name: task, cwd: session.workdir, prompt, model, settings: settingsFor(task, session.workdir) }
    const sessionId = await launchIn(home, { ...start, ...agentExtras(home, project) })
    const snapshot = { at, task, sessionId, previous: session.sessionId, reason: snapshotReason(reason), prompt, notePath, note }
    try {
      saveSnapshot(handoffsDir, snapshot)
    } catch (error) {
      console.warn(`chain: handoff snapshot of ${task} not saved: ${(error as Error).message}`)
    }
    return sessionId
  },
  launchFix: async (project, name, report) => {
    const home = homeOf(startHomeKey(agentFor(project)))
    await daemons.prepare(home)
    const place = await places.ready(project, name)
    const { prompt, model } = planFor(name, withProject(fixPrompt(report, place, promptLanguage(), branchOf(project)), project), project)
    return launchIn(home, { name, cwd: place.path, prompt, model, settings: settingsFor(name, place.path, project), ...agentExtras(home, project) })
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
  limits: limits.limits(ledger.active),
  usage: limits.usage(ledger.active),
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
  mcpMissing: mcp.missing,
  mcpFailed: mcp.failed,
  language: configFile.current.language,
  unattended: dispatcher.state.unattended,
  trimTools: dispatcher.state.trimTools,
  updates: updatesView(release.version, updates.latest, configFile.current.updates),
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
  launches: () => launches,
  sessionRecord: async (sessionId) => {
    for (const home of homes.list()) {
      const found = await agentOf(home).record(home, sessionId)
      if (found !== undefined) return { ...found, account: sessionAccount(sessionId, found.startedAt) ?? emailAt(home.key, found.startedAt) }
    }
    return undefined
  },
  transcript: (sessionId, after) => inHomes((home) => agentOf(home).feed(home, sessionId, after)),
  checkpoint: async (sessionId) => {
    const run = handoffsOf(launches, sessionId)
    if (run === undefined) return undefined
    const { first, source } = await stats.checkpoint(run.project)
    return { ...run, first, source }
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
      mode: agentOf(homes.find(ledger.active) ?? homes.global).mode,
    })
    const received = view.received
    return received === null ? view : { ...view, received: { ...received, account: sessionAccount(received.sessionId, received.at) } }
  },
  tasks: {
    card: async (task) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : links.get(config.trackers[project]!)
      if (link === undefined) return undefined
      return link.run(async (tracker) =>
        tracker.card === undefined ? undefined : cardOf(await tracker.card(task), rulesOf(project!), tracker.ready !== undefined),
      )
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
mcp.run()
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

