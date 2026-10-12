import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DaemonRefresh } from './account/daemon.js'
import { AccountHomes, accountsRoot, type AccountHome } from './account/homes.js'
import { accountAt, activate, forgetAccount, loadLedger, markRemoving, noteAccount, saveLedger, type AccountLedger } from './account/ledger.js'
import { accountId, launchBlock, liveSessions, loginBlock, type LoginBlock } from './account/model.js'
import { VsCodeAccount, vscodeSettingsFile } from './account/vscode.js'
import { AccountWatcher } from './account/watcher.js'
import { Dispatcher, type LaunchEntry } from './chain/dispatcher.js'
import { handoffsOf, launchDays, taskSessions } from './chain/launches.js'
import { isFixName } from './chain/fix.js'
import { fixPrompt, noteOf, resumePrompt, startPrompt, withBrief, withProjectPrompt, withReport, withUnattended } from './chain/relay.js'
import { launchLine } from './chain/log.js'
import { mainCheckDeps, mergeCheck } from './chain/mainci.js'
import { TaskPlaces } from './chain/places.js'
import { readNote, saveSnapshot, snapshotReason } from './chain/snapshots.js'
import { appendLaunch, loadChainState, readLaunches, saveChainState } from './chain/store.js'
import { CI_TOKENS, ciSource, projectTargets } from './ci/adapters.js'
import { CiWatch } from './ci/watcher.js'
import { ConfigFile } from './config-file.js'
import { DEFAULT_BRANCH, DEFAULT_CI, listenOf } from './config.js'
import { EventHub } from './events.js'
import { runGit } from './git/run.js'
import { finishSlot, prepareSlot, slotPaths, type SlotUse } from './git/slot.js'
import { ensureIgnored, finishWorktree, prepareWorktree, requireBranch, taskPlace } from './git/worktree.js'
import { exhaustedReset } from './limits/model.js'
import { LimitsWatcher } from './limits/watcher.js'
import { englishOf, fail, notice, noticeOf, type Notice } from './notice/notice.js'
import { guardHosts, guardToken } from './guard.js'
import { createEvenKeelServer } from './server.js'
import { replyPrompt, type Reply } from './sessions/ask.js'
import { saveInbox, type InboxFile } from './sessions/inbox.js'
import { ClaudeCli, liveRecords, resolveClaudeBinary, SESSION_MODE } from './sessions/claude.js'
import { turnStatus, type AgentEntry } from './sessions/agents.js'
import { launchPlan, type LaunchPlan } from './sessions/launch.js'
import { readSessionRecord, readTranscript } from './sessions/history.js'
import { runBeforeStart, runCheck, systemShell, type SetupRun } from './sessions/setup.js'
import { SessionMonitor } from './sessions/monitor.js'
import { TranscriptOwners } from './sessions/owners.js'
import { isInside } from './paths.js'
import { slotOccupants } from './sessions/occupants.js'
import { locateWorktree } from './sessions/place.js'
import type { EvenKeelState, SessionView } from './state.js'
import { StatsReader } from './stats/reader.js'
import { TallyService } from './stats/tally.js'
import { chainSettings, readToolsView } from './tools/panel.js'
import { ADAPTERS } from './tracker/adapters.js'
import { cardOf } from './tracker/card.js'
import { McpCheck, readMcpSources } from './tracker/mcp.js'
import type { TrackerView } from './tracker/health.js'
import type { TrackerLink } from './tracker/link.js'
import { parseTaskId, type Task } from './tracker/model.js'
import { TrackerQuestions, type AskingSession, type PostedQuestion } from './tracker/questions.js'
import type { TrackerSetup } from './tracker/source.js'
import { startTracker } from './tracker/start.js'

const SESSION_POLL_MS = 3_000
const CLAUDE_TIMEOUT_MS = 30_000
const LIMITS_POLL_MS = 2_000
const USAGE_POLL_MS = 5 * 60_000
const LAUNCH_CHART_DAYS = 14
const ACCOUNT_POLL_MS = 60_000
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
try {
  process.loadEnvFile(join(root, '.env'))
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

const configFile = new ConfigFile({
  file: process.env.EVEN_KEEL_CONFIG ?? join(root, 'even-keel.config.json'),
  intervalMs: CONFIG_POLL_MS,
  warn: (message) => console.warn(message),
  onChange: () => {
    for (const [project, tasks] of tasksByProject) dispatcher.setTasks(project, tasks)
    dispatcher.check()
    mcp.run()
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
const stateDir = process.env.EVEN_KEEL_STATE_DIR ?? join(root, 'state')
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
const cli = new ClaudeCli(() => resolveClaudeBinary(process.env), CLAUDE_TIMEOUT_MS, (home) => homes.envOf(home))
const startedAt = new Date().toISOString()
const tasksByProject = new Map<string, Task[]>()
const ciWatches = new Map<string, CiWatch[]>()
let sessions: SessionView[] = []
let agents: AgentEntry[] = []
let agentsRead = false
const launches: LaunchEntry[] = readLaunches(launchesFile)
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
  usage: (home) => cli.usage(home, stateDir),
  usageIntervalMs: USAGE_POLL_MS,
  notBefore: (key) => ledger.accounts[key]?.since ?? null,
  accessExpired: (home) => {
    const { accessExpiresAt } = homes.times(home)
    return accessExpiresAt !== null && accessExpiresAt <= Date.now()
  },
  onChange: () => hub.broadcast('state', getState()),
  onError: (error) => console.error(`limits: ${error instanceof Error ? error.message : String(error)}`),
})

const daemons = new DaemonRefresh({
  share: (home) => homes.share(home),
  running: async (home) => liveSessions(await cli.agents(home), home.key).length,
  stopDaemon: (home) => cli.stopDaemon(home),
  onChange: () => hub.broadcast('state', getState()),
  onError: (error) => console.error(`account: ${error instanceof Error ? error.message : String(error)}`),
})

const vscode = new VsCodeAccount({
  file: vscodeSettingsFile(process.env),
  homes: () => homes.list(),
  ownerOf: (dir) => homes.ownerOf(dir),
  records: liveRecords,
  intervalMs: APP_POLL_MS,
  onChange: () => hub.broadcast('state', getState()),
  onError: (error) => console.error(`vscode: ${error instanceof Error ? error.message : String(error)}`),
})

const account = new AccountWatcher({
  homes,
  cli,
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
  loginBlock: (): LoginBlock | null => loginBlock(dispatcher.state.active, agents, ledger.active),
  sessionsIn: (key) => liveSessions(agents, key),
  sessionsKnown: () => agentsRead,
  removing: (key) => ledger.removing.includes(key),
  markRemoving: (key, on) => saveAccounts(markRemoving(ledger, key, on)),
  configPending: (key) => daemons.pending(key),
  limits: (key) => limits.limits(key),
  usage: (key) => limits.usage(key),
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

const activeAccount = () => {
  const view = account.view
  const entry = view.accounts.find((each) => each.key === view.active)
  const email = entry?.status?.loggedIn === true ? entry.status.email : null
  return { id: accountId(view.active, email), ready: email !== null && launchBlock(view) === undefined }
}

const monitor = new SessionMonitor({
  cli,
  homes: () => homes.list(),
  emailOf: (key) => account.emailOf(key),
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

const planFor = (task: string, prompt: string): LaunchPlan => {
  const known = [...tasksByProject.values()].flat().find((each) => each.id === task)
  const full = withUnattended(prompt, dispatcher.state.unattended, promptLanguage())
  const plan = launchPlan(known, full, configFile.current.model, configFile.current.modelPrompts)
  if (plan.warning !== null) console.warn(plan.warning)
  return plan
}

const promptLanguage = () => configFile.current.promptLanguage

const briefed = async (task: string, prompt: string, project = projectOf(task)): Promise<string> => {
  if (project === undefined) return prompt
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
      return server === undefined || configFile.current.briefs[project] ? [] : [{ project, repo, server }]
    }),
  read: (repo) =>
    readMcpSources(repo, { claudeDir: homes.global.dir, configs: claudeConfigs() }),
  warn: (line) => console.warn(line),
  onChange: () => hub.broadcast('state', getState()),
})

const settingsFor = (task: string, cwd: string, project = projectOf(task)): string | undefined =>
  project === undefined
    ? undefined
    : chainSettings(config.projects[project]!, cwd, dispatcher.state.trimTools, configFile.current.hiddenSkills, homes.global.dir)

function projectOf(task: string): string | undefined {
  for (const [project, tasks] of tasksByProject) if (tasks.some((each) => each.id === task)) return project
  return dispatcher.state.active.find((chain) => chain.current?.task === task)?.project
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
  return { task, cwd, shell: systemShell(() => homes.envOf(homeOf(ledger.active))), log: (line) => console.log(line) }
}

const dispatcher = new Dispatcher(loadChainState(chainFile), {
  projects: Object.keys(config.projects),
  parallel: () => configFile.current.parallel,
  rules: rulesOf,
  launch: async (project, task) => {
    const home = homeOf(ledger.active)
    await daemons.prepare(home)
    const place = await places.ready(project, task)
    const { prompt, model } = planFor(task, withProject(await briefed(task, startPrompt(task, place, promptLanguage(), branchOf(project)), project), project))
    return (await cli.launch(home, task, place.path, prompt, model, settingsFor(task, place.path, project))).sessionId
  },
  liveSession: (task) => sessions.find((view) => view.task === task && view.lamp !== 'finished')?.sessionId,
  blocked: () => launchBlock(account.view),
  busy: (task) => {
    const status = agentStatus(task)
    return status === 'busy' || status === 'waiting'
  },
  midTurn: (task) => agentStatus(task) === 'busy',
  asked: (task) => liveView(task)?.ask?.id ?? null,
  save: (state) => {
    saveChainState(chainFile, state)
    hub.broadcast('state', getState())
  },
  journal: (entry) => {
    appendLaunch(launchesFile, entry)
    launches.push(entry)
    console.log(launchLine(entry))
  },
  now: () => new Date(),
  limited: (task) => monitor.limited(task),
  handoff: (task) => monitor.handoff(task),
  locate: locateWorktree,
  account: activeAccount,
  accountAt: (key, at) => accountId(key, accountAt(ledger, key, at)),
  limitReset: () => exhaustedReset(limits.limits(ledger.active)),
  promptLanguage,
  mainBranch: (task) => {
    const project = projectOf(task)
    return project === undefined ? DEFAULT_BRANCH : branchOf(project)
  },
  resume: async (task, session) => {
    const home = homeOf(session.account)
    await cli.stop(home, session.agentId, session.sessionId)
    await daemons.prepare(home)
    const plan = planFor(task, resumePrompt(promptLanguage()))
    return (await cli.resume(home, session.sessionId, task, session.cwd, plan.prompt, plan.model, settingsFor(task, session.cwd))).sessionId
  },
  reply: async (task, session, prompt) => {
    const home = homeOf(session.account)
    await cli.stop(home, session.agentId, session.sessionId)
    await daemons.prepare(home)
    const plan = planFor(task, prompt)
    return (await cli.resume(home, session.sessionId, task, session.cwd, plan.prompt, plan.model, settingsFor(task, session.cwd))).sessionId
  },
  relay: async (task, session, handoff, reason) => {
    const previous = homes.find(session.account)
    if (previous !== undefined) await cli.stop(previous, session.agentId, session.sessionId)
    const home = homeOf(ledger.active)
    await daemons.prepare(home)
    const project = projectOf(task)
    const told = isFixName(task) ? withReport(handoff, project === undefined ? undefined : dispatcher.state.ci[project]?.fix?.report) : await briefed(task, handoff)
    const { prompt, model } = planFor(task, withProject(told, project))
    const notePath = noteOf(session)
    const note = await readNote(notePath)
    const at = new Date().toISOString()
    const { sessionId } = await cli.launch(home, task, session.workdir, prompt, model, settingsFor(task, session.workdir))
    const snapshot = { at, task, sessionId, previous: session.sessionId, reason: snapshotReason(reason), prompt, notePath, note }
    try {
      saveSnapshot(handoffsDir, snapshot)
    } catch (error) {
      console.warn(`chain: handoff snapshot of ${task} not saved: ${(error as Error).message}`)
    }
    return sessionId
  },
  launchFix: async (project, name, report) => {
    const home = homeOf(ledger.active)
    await daemons.prepare(home)
    const place = await places.ready(project, name)
    const { prompt, model } = planFor(name, withProject(fixPrompt(report, place, promptLanguage(), branchOf(project)), project))
    return (await cli.launch(home, name, place.path, prompt, model, settingsFor(name, place.path, project))).sessionId
  },
  stop: (session) => cli.stop(homeOf(session.account), session.agentId, session.sessionId),
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
  log: (message) => console.log(message),
  main: mainCheckDeps({
    repo: (project) => config.projects[project]!,
    main: branchOf,
    git: runGit,
    watches: (project) => ciWatches.get(project) ?? [],
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
      await cli.stop(homeOf(agent.account ?? 'global'), agent.id!, agent.sessionId)
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
      agent.pid !== undefined &&
      (isInside(agent.cwd, taskPlace(repo, task).path) || (slots.some((slot) => isInside(agent.cwd, slot)) && own.has(agent.sessionId))) &&
      agent.status !== 'busy' &&
      agent.status !== 'waiting',
  )
  const warnings: Notice[] = []
  for (const agent of idle) {
    try {
      await cli.stop(homeOf(agent.account ?? 'global'), agent.id!, agent.sessionId)
    } catch (error) {
      warnings.push(notice('cleanup.sessionNotStopped', { session: agent.sessionId }, { cause: noticeOf(error) }))
    }
  }
  return warnings
}

const getState = (): EvenKeelState => ({
  startedAt,
  projects: Object.keys(config.projects),
  config: configFile.view(),
  chain: {
    active: dispatcher.state.active,
    parallel: configFile.current.parallel,
    queue: dispatcher.state.queue,
    projects: dispatcher.orders(),
    skipped: dispatcher.state.skipped,
    leftovers: dispatcher.state.leftovers,
  },
  tasks: [...tasksByProject.values()].flat(),
  sessions: sessions.map((view) => (view.lamp === 'finished' ? { ...view, feed: [] } : view)),
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
  context: config.context,
  configError: configFile.error,
  mcpMissing: mcp.missing,
  language: configFile.current.language,
  unattended: dispatcher.state.unattended,
  trimTools: dispatcher.state.trimTools,
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
    save: (project, form) => {
      if (config.projects[project] === undefined) throw fail('config.unknownProject', { key: project })
      configFile.saveProject(project, form)
      console.log(`page: the settings of ${project} are written to the config`)
    },
    saveShared: (form) => {
      configFile.saveShared(form)
      console.log('page: the shared settings are written to the config')
    },
  },
  launches: () => launches,
  sessionRecord: async (sessionId) => {
    for (const home of homes.list()) {
      const found = await readSessionRecord(join(home.dir, 'projects'), sessionId)
      if (found !== undefined) return { ...found, account: sessionAccount(sessionId, found.startedAt) ?? emailAt(home.key, found.startedAt) }
    }
    return undefined
  },
  transcript: (sessionId, after) => inHomes((projects) => readTranscript(projects, sessionId, after)),
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
      mode: SESSION_MODE,
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

/** The first answer `read` finds in the `projects` folder of any account. */
async function inHomes<T>(read: (projectsDir: string) => Promise<T | undefined>): Promise<T | undefined> {
  for (const home of homes.list()) {
    const found = await read(join(home.dir, 'projects'))
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
  sessions: () =>
    dispatcher.state.active.flatMap((chain): AskingSession[] => {
      const sessionId = chain.current?.sessionId
      const view = sessionId == null ? undefined : liveView(chain.current!.task)
      if (view === undefined || view.sessionId !== sessionId || isFixName(view.task)) return []
      return [{ project: chain.project, task: view.task, sessionId, ask: view.ask }]
    }),
  tracker: (project, call) => links.get(config.trackers[project]!)?.run(call),
  language: () => configFile.current.language ?? promptLanguage(),
  load: () => {
    try {
      return JSON.parse(readFileSync(questionsFile, 'utf8')) as PostedQuestion[]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  },
  save: (posted) => writeFileSync(questionsFile, `${JSON.stringify(posted, null, 2)}\n`),
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
  setInterval(() => {
    for (const watch of [...ciWatches.values()].flat()) void watch.tick()
  }, CI_TICK_MS).unref()
  for (const watch of [...ciWatches.values()].flat()) void watch.tick()
})()

monitor.start()
void owners.scan()
limits.start()
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
  if (setup === undefined) console.log(`${view.name}: ${ADAPTERS[view.name]!.variables.join(', ')} are not set, tracker is off`)
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
    })
  }
}

