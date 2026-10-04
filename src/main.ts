import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DaemonRefresh } from './account/daemon.js'
import { AccountHomes, accountsRoot, type AccountHome } from './account/homes.js'
import { accountAt, activate, forgetAccount, loadLedger, markRemoving, noteAccount, saveLedger, type AccountLedger } from './account/ledger.js'
import { accountId, launchBlock, liveSessions, loginBlock, type LoginBlock } from './account/model.js'
import { VsCodeAccount, vscodeSettingsFile } from './account/vscode.js'
import { AccountWatcher } from './account/watcher.js'
import { Dispatcher, type LaunchEntry } from './chain/dispatcher.js'
import { launchDays, taskSessions } from './chain/launches.js'
import { RESUME_PROMPT, startPrompt, withBrief } from './chain/relay.js'
import { appendLaunch, loadChainState, readLaunches, saveChainState } from './chain/store.js'
import { ConfigFile } from './config-file.js'
import { EventHub } from './events.js'
import { branchMerged } from './git/merged.js'
import { runGit } from './git/run.js'
import { finishSlot, prepareSlot, slotPaths, type SlotUse } from './git/slot.js'
import { ensureIgnored, finishWorktree, prepareWorktree, taskPlace } from './git/worktree.js'
import { exhaustedReset } from './limits/model.js'
import { LimitsWatcher } from './limits/watcher.js'
import { createEvenKeelServer } from './server.js'
import { ClaudeCli, liveRecords, resolveClaudeBinary } from './sessions/claude.js'
import type { AgentEntry } from './sessions/agents.js'
import { launchPlan, type LaunchPlan } from './sessions/launch.js'
import { readSessionRecord } from './sessions/history.js'
import { SessionMonitor } from './sessions/monitor.js'
import { isInside, slotOccupants } from './sessions/occupants.js'
import { locateWorktree } from './sessions/place.js'
import type { EvenKeelState, SessionView } from './state.js'
import { readerSettings } from './stats/model.js'
import { StatsReader } from './stats/reader.js'
import { ADAPTERS } from './tracker/adapters.js'
import { MergeCloser } from './tracker/closer.js'
import { worthBroadcast, type TrackerView } from './tracker/health.js'
import { TrackerLink } from './tracker/link.js'
import type { Task } from './tracker/model.js'
import { StatusPoller } from './tracker/poller.js'
import { trackerOf, type TrackerSetup } from './tracker/source.js'

const TRACKER_POLL_MS = 5_000
const TASKS_REFRESH_MS = 30_000
const TRACKER_TIMEOUT_MS = 15_000
const SESSION_POLL_MS = 3_000
const CLAUDE_TIMEOUT_MS = 30_000
const LIMITS_POLL_MS = 2_000
const USAGE_POLL_MS = 5 * 60_000
const LAUNCH_CHART_DAYS = 14
const ACCOUNT_POLL_MS = 60_000
const APP_POLL_MS = 5_000
const LOGIN_TIMEOUT_MS = 10 * 60_000
const LIMIT_CHECK_MS = 30_000
const CONFIG_POLL_MS = 2_000

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
    hub.broadcast('state', getState())
  },
})
const config = configFile.current
const rulesOf = (project: string) => configFile.current.rules[project]!
const stateDir = process.env.EVEN_KEEL_STATE_DIR ?? join(root, 'state')
mkdirSync(stateDir, { recursive: true })
const chainFile = join(stateDir, 'chain.json')
const launchesFile = join(stateDir, 'launches.jsonl')
const limitsFile = join(stateDir, 'rate-limits.json')
const accountFile = join(stateDir, 'account.json')
const trackerNames = [...new Set([config.tracker, ...Object.values(config.trackers)])]
const setups = new Map<string, TrackerSetup | undefined>(trackerNames.map((name) => [name, ADAPTERS[name]!.setup(process.env)]))
const trackerProjects = (name: string) => Object.keys(config.projects).filter((project) => config.trackers[project] === name)
const trackers = new Map<string, TrackerView>(
  trackerNames
    .filter((name) => trackerProjects(name).length > 0)
    .map((name) => [name, { name, title: ADAPTERS[name]!.title, projects: trackerProjects(name), health: { state: 'off', lastOkAt: null, error: null } }]),
)
const links = new Map<string, TrackerLink>()
const hub = new EventHub()
const homes = new AccountHomes(process.env, accountsRoot(process.env))
const cli = new ClaudeCli(() => resolveClaudeBinary(process.env), CLAUDE_TIMEOUT_MS, (home) => homes.envOf(home))
const startedAt = new Date().toISOString()
const tasksByProject = new Map<string, Task[]>()
let sessions: SessionView[] = []
let agents: AgentEntry[] = []
let agentsRead = false
const launches: LaunchEntry[] = readLaunches(launchesFile)
const stats = new StatsReader(readerSettings(process.env), config.projects, () => configFile.current.stats.compare)
let ledger = loadLedger(accountFile)

const saveAccounts = (next: AccountLedger) => {
  ledger = next
  saveLedger(accountFile, ledger)
}

const homeOf = (key: string): AccountHome => {
  const home = homes.find(key)
  if (home === undefined) throw new Error(`claude: the account folder ${key} is gone`)
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
    hub.broadcast('state', getState())
    dispatcher.check()
  },
  onError: (error) => console.error(`sessions: ${error instanceof Error ? error.message : String(error)}`),
})

const planFor = (task: string, prompt: string): LaunchPlan => {
  const known = [...tasksByProject.values()].flat().find((each) => each.id === task)
  const plan = launchPlan(known, prompt, configFile.current.modelPrompts)
  if (plan.warning !== null) console.warn(plan.warning)
  return plan
}

const briefed = async (task: string, prompt: string, project = projectOf(task)): Promise<string> => {
  const link = project === undefined ? undefined : links.get(config.trackers[project]!)
  return link === undefined ? prompt : withBrief(prompt, await link.run(async (tracker) => tracker.brief?.(task)))
}

function projectOf(task: string): string | undefined {
  for (const [project, tasks] of tasksByProject) if (tasks.some((each) => each.id === task)) return project
  return dispatcher.state.active?.project
}

const dispatcher = new Dispatcher(loadChainState(chainFile), {
  projects: Object.keys(config.projects),
  rules: rulesOf,
  launch: async (project, task) => {
    const home = homeOf(ledger.active)
    await daemons.prepare(home)
    const repo = config.projects[project]!
    await ensureIgnored(runGit, repo)
    const count = config.slots[project]
    const place =
      count !== undefined
        ? await prepareSlot(runGit, repo, task, {
            count,
            occupancy: (path) => slotUse(path, task),
            vacate: (path) => vacateSlot(path, task),
          })
        : await prepareWorktree(runGit, repo, task)
    const { prompt, model } = planFor(task, await briefed(task, startPrompt(task, place), project))
    return (await cli.launch(home, task, place.path, prompt, model)).sessionId
  },
  liveSession: (task) => sessions.find((view) => view.task === task && view.lamp !== 'finished')?.sessionId,
  blocked: (): string | undefined => launchBlock(account.view),
  busy: (task) => {
    const view = sessions.find((each) => each.task === task && each.lamp !== 'finished')
    const status = view && agents.find((agent) => agent.sessionId === view.sessionId)?.status
    return status === 'busy' || status === 'waiting'
  },
  save: (state) => {
    saveChainState(chainFile, state)
    hub.broadcast('state', getState())
  },
  journal: (entry) => {
    appendLaunch(launchesFile, entry)
    launches.push(entry)
  },
  now: () => new Date(),
  limited: (task) => monitor.limited(task),
  handoff: (task) => monitor.handoff(task),
  locate: locateWorktree,
  account: activeAccount,
  accountAt: (key, at) => accountId(key, accountAt(ledger, key, at)),
  limitReset: () => exhaustedReset(limits.limits(ledger.active)),
  resume: async (task, session) => {
    const home = homeOf(session.account)
    await cli.stop(home, session.agentId, session.sessionId)
    await daemons.prepare(home)
    const plan = planFor(task, RESUME_PROMPT)
    return (await cli.resume(home, session.sessionId, task, session.cwd, plan.prompt, plan.model)).sessionId
  },
  relay: async (task, session, handoff) => {
    const previous = homes.find(session.account)
    if (previous !== undefined) await cli.stop(previous, session.agentId, session.sessionId)
    const home = homeOf(ledger.active)
    await daemons.prepare(home)
    const { prompt, model } = planFor(task, await briefed(task, handoff))
    return (await cli.launch(home, task, session.workdir, prompt, model)).sessionId
  },
  finish: async (project, task) => {
    const repo = config.projects[project]!
    const count = config.slots[project]
    const stopped = await stopTaskSessions(repo, task, count ?? 1)
    const finished = await (count !== undefined ? finishSlot(runGit, repo, task, count) : finishWorktree(runGit, repo, task))
    const outcome = { ...finished, warnings: [...stopped, ...finished.warnings] }
    for (const warning of outcome.warnings) console.warn(`git: ${warning}`)
    if (outcome.syncError !== null) console.error(`git: sync of ${project} after ${task} failed: ${outcome.syncError}`)
    return outcome
  },
})

function occupantsOf(slot: string, task: string) {
  const owners = new Map(launches.map((entry) => [entry.sessionId, entry.task]))
  return slotOccupants(agents, owners, slot, task)
}

function slotUse(slot: string, task: string): SlotUse {
  const { idle, busy } = occupantsOf(slot, task)
  return { idle: idle.length > 0, busy: busy.map((each) => `${each.task} (session ${each.agent.sessionId})`) }
}

async function vacateSlot(slot: string, task: string): Promise<void> {
  const { idle, busy } = occupantsOf(slot, task)
  if (busy.length > 0) {
    const names = busy.map((each) => `${each.task} (session ${each.agent.sessionId})`).join(', ')
    throw new Error(`the slot ${slot} is in use by ${names} mid-turn, ${task} was not started; let it finish or stop it, then resume`)
  }
  for (const { agent, task: owner } of idle) {
    try {
      await cli.stop(homeOf(agent.account ?? 'global'), agent.id!, agent.sessionId)
    } catch (error) {
      throw new Error(`the session ${agent.sessionId} of ${owner} in the slot ${slot} was not stopped, ${task} was not started: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    console.log(`slot: stopped the session ${agent.sessionId} of ${owner} before ${task} took ${slot}`)
  }
}

async function stopTaskSessions(repo: string, task: string, count: number): Promise<string[]> {
  const own = new Set(launches.filter((entry) => entry.task === task).map((entry) => entry.sessionId))
  const slots = slotPaths(repo, count)
  const idle = agents.filter(
    (agent) =>
      agent.id !== undefined &&
      (isInside(agent.cwd, taskPlace(repo, task).path) || (slots.some((slot) => isInside(agent.cwd, slot)) && own.has(agent.sessionId))) &&
      agent.status !== 'busy' &&
      agent.status !== 'waiting' &&
      agent.state !== 'stopped' &&
      agent.state !== 'failed',
  )
  const warnings: string[] = []
  for (const agent of idle) {
    try {
      await cli.stop(homeOf(agent.account ?? 'global'), agent.id!, agent.sessionId)
    } catch (error) {
      warnings.push(`${task}: its session ${agent.sessionId} was not stopped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return warnings
}

const getState = (): EvenKeelState => ({
  startedAt,
  projects: Object.keys(config.projects),
  chain: {
    active: dispatcher.state.active,
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
    default: setups.get(config.tracker)?.issueUrlBase ?? null,
    projects: Object.fromEntries(Object.keys(config.projects).map((project) => [project, setups.get(config.trackers[project]!)?.issueUrlBase ?? null])),
  },
  launches: launchDays(launches, new Date(), LAUNCH_CHART_DAYS),
  taskSessions: taskSessions(launches, sessions),
  context: config.context,
  configError: configFile.error,
})

const server = createEvenKeelServer({
  hub,
  publicDir: join(root, 'dist', 'web'),
  getState,
  control: dispatcher,
  account,
  launches: () => launches,
  sessionRecord: async (sessionId) => {
    for (const home of homes.list()) {
      const record = await readSessionRecord(join(home.dir, 'projects'), sessionId)
      if (record !== undefined) return record
    }
    return undefined
  },
  stats,
})

setInterval(() => hub.broadcast('ping', { at: new Date().toISOString() }), 15_000).unref()

setInterval(() => dispatcher.check(), LIMIT_CHECK_MS).unref()

monitor.start()
limits.start()
account.start()
vscode.start()
configFile.watch()

server.listen(config.port, config.host, () => {
  console.log(`even-keel listening on http://${config.host}:${config.port}`)
})

for (const view of trackers.values()) {
  const setup = setups.get(view.name)
  if (setup === undefined) console.log(`${view.name}: ${ADAPTERS[view.name]!.variables.join(', ')} are not set, tracker is off`)
  else startTracker(view, setup)
}

function startTracker(view: TrackerView, setup: TrackerSetup): void {
  const { name, projects } = view
  let completes = false
  const link = new TrackerLink({
    name,
    connect: async () => {
      const tracker = trackerOf(await setup.connect(TRACKER_TIMEOUT_MS))
      completes = tracker.complete !== undefined
      return tracker
    },
    timeoutMs: TRACKER_TIMEOUT_MS,
    onHealth: (health) => {
      const before = view.health
      view.health = health
      if (worthBroadcast(before, health)) hub.broadcast('state', getState())
    },
  })
  links.set(name, link)
  view.health = link.health
  const report = (error: unknown) => console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`)
  const ownTasks = () => projects.flatMap((project) => tasksByProject.get(project) ?? [])

  const closer = new MergeCloser({
    merged: (project, task) => branchMerged(runGit, config.projects[project]!, task),
    complete: (task) => link.run((tracker) => tracker.complete!(task)),
    onError: report,
  })

  const poller = new StatusPoller({
    link,
    watched: () => ownTasks().map((task) => task.id),
    intervalMs: TRACKER_POLL_MS,
    onChange: (changes) => {
      const byId = new Map(changes.map((change) => [change.id, change.to]))
      for (const project of projects) {
        const tasks = tasksByProject.get(project)
        if (tasks === undefined || !tasks.some((task) => byId.has(task.id))) continue
        const updated = tasks.flatMap((task) => {
          const status = byId.has(task.id) ? byId.get(task.id) : task.status
          return status ? [{ ...task, status }] : []
        })
        tasksByProject.set(project, updated)
        dispatcher.setTasks(project, updated)
      }
      hub.broadcast('state', getState())
    },
    onError: report,
  })

  const unknownByProject = new Map<string, string>()
  const refreshTasks = async (): Promise<void> => {
    await Promise.all(
      projects.map(async (project) => {
        try {
          const { tasks, unknownStatuses } = await link.run((tracker) => tracker.chainTasks(project, rulesOf(project)))
          const unknown = unknownStatuses.join('", "')
          if (unknown !== (unknownByProject.get(project) ?? '') && unknown !== '') {
            console.warn(`config: ${view.title} has no status "${unknown}" named in the chain rules of ${project}`)
          }
          unknownByProject.set(project, unknown)
          tasksByProject.set(project, tasks)
          dispatcher.setTasks(project, tasks)
          const released = dispatcher.released(project)
          if (released.length > 0) dispatcher.setReleased(project, await link.run((tracker) => tracker.tasks(released)))
          if (!completes) return
          for (const task of await closer.sweep(project, dispatcher.held(project))) {
            console.log(`${name}: closed ${task}, its branch is merged into main`)
          }
        } catch (error) {
          report(error)
        }
      }),
    )
    hub.broadcast('state', getState())
    poller.start()
    setTimeout(() => void refreshTasks(), projects.some((project) => tasksByProject.has(project)) ? TASKS_REFRESH_MS : TRACKER_POLL_MS)
  }
  void refreshTasks()
}
