import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DaemonRefresh } from './account/daemon.js'
import { AccountHomes, accountsRoot, type AccountHome } from './account/homes.js'
import { accountAt, activate, forgetAccount, loadLedger, noteAccount, saveLedger, type AccountLedger } from './account/ledger.js'
import { accountId, launchBlock, loginBlock, type LoginBlock } from './account/model.js'
import { AccountWatcher } from './account/watcher.js'
import { Dispatcher, type LaunchEntry } from './chain/dispatcher.js'
import { launchDays, taskSessions } from './chain/launches.js'
import { RESUME_PROMPT } from './chain/relay.js'
import { appendLaunch, loadChainState, readLaunches, saveChainState } from './chain/store.js'
import { loadConfig } from './config.js'
import { EventHub } from './events.js'
import { issueUrlBase, readHulyCredentials } from './huly/credentials.js'
import type { HulyHealth } from './huly/health.js'
import { HulyLink } from './huly/link.js'
import type { HulyTask } from './huly/model.js'
import { StatusPoller } from './huly/poller.js'
import { exhaustedReset } from './limits/model.js'
import { LimitsWatcher } from './limits/watcher.js'
import { connectHuly } from './huly/source.js'
import { createBatonServer } from './server.js'
import { ClaudeCli, resolveClaudeBinary } from './sessions/claude.js'
import type { AgentEntry } from './sessions/agents.js'
import { launchPlan, type LaunchPlan } from './sessions/launch.js'
import { readSessionRecord } from './sessions/history.js'
import { SessionMonitor } from './sessions/monitor.js'
import { locateWorktree } from './sessions/place.js'
import type { BatonState, SessionView } from './state.js'

const HULY_POLL_MS = 5_000
const TASKS_REFRESH_MS = 30_000
const HULY_TIMEOUT_MS = 15_000
const SESSION_POLL_MS = 3_000
const CLAUDE_TIMEOUT_MS = 30_000
const LIMITS_POLL_MS = 2_000
const USAGE_POLL_MS = 60_000
const LAUNCH_CHART_DAYS = 14
const ACCOUNT_POLL_MS = 60_000
const LOGIN_TIMEOUT_MS = 10 * 60_000
const LIMIT_CHECK_MS = 30_000

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
try {
  process.loadEnvFile(join(root, '.env'))
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

const config = loadConfig(process.env.BATON_CONFIG ?? join(root, 'baton.config.json'))
const stateDir = process.env.BATON_STATE_DIR ?? join(root, 'state')
mkdirSync(stateDir, { recursive: true })
const chainFile = join(stateDir, 'chain.json')
const launchesFile = join(stateDir, 'launches.jsonl')
const limitsFile = join(stateDir, 'rate-limits.json')
const accountFile = join(stateDir, 'account.json')
const credentials = readHulyCredentials(process.env)
const hub = new EventHub()
const homes = new AccountHomes(process.env, accountsRoot(process.env))
const cli = new ClaudeCli(() => resolveClaudeBinary(process.env), CLAUDE_TIMEOUT_MS, (home) => homes.envOf(home))
const startedAt = new Date().toISOString()
const tasksByProject = new Map<string, HulyTask[]>()
let sessions: SessionView[] = []
let agents: AgentEntry[] = []
let huly: HulyHealth = { state: 'off', lastOkAt: null, error: null }
const launches: LaunchEntry[] = readLaunches(launchesFile)
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
  running: async (home) => (await cli.agents(home)).filter((agent) => !isOver(agent)).length,
  stopDaemon: (home) => cli.stopDaemon(home),
  onChange: () => hub.broadcast('state', getState()),
  onError: (error) => console.error(`account: ${error instanceof Error ? error.message : String(error)}`),
})

const account = new AccountWatcher({
  homes,
  cli,
  active: () => ledger.active,
  activate: (key) => {
    saveAccounts(activate(ledger, key))
    hub.broadcast('state', getState())
    dispatcher.check()
  },
  forget: (key) => saveAccounts(forgetAccount(ledger, key)),
  loginBlock: (): LoginBlock | null => loginBlock(dispatcher.state.active, agents, ledger.active),
  sessionsIn: (key) => agents.filter((agent) => agent.account === key && !isOver(agent)).length,
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
  const plan = launchPlan(known, prompt, config.modelPrompts)
  if (plan.warning !== null) console.warn(plan.warning)
  return plan
}

const dispatcher = new Dispatcher(loadChainState(chainFile), {
  projects: Object.keys(config.projects),
  launch: async (project, task) => {
    const home = homeOf(ledger.active)
    await daemons.prepare(home)
    const { prompt, model } = planFor(task, task)
    return (await cli.launch(home, task, config.projects[project]!, prompt, model)).sessionId
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
    const { prompt, model } = planFor(task, handoff)
    return (await cli.launch(home, task, session.workdir, prompt, model)).sessionId
  },
})

function isOver(agent: AgentEntry): boolean {
  return agent.state === 'done' || agent.state === 'stopped' || agent.state === 'failed'
}

const getState = (): BatonState => ({
  startedAt,
  projects: Object.keys(config.projects),
  chain: {
    active: dispatcher.state.active,
    queue: dispatcher.state.queue,
    projects: dispatcher.orders(),
    skipped: dispatcher.state.skipped,
  },
  tasks: [...tasksByProject.values()].flat(),
  sessions,
  limits: limits.limits(ledger.active),
  usage: limits.usage(ledger.active),
  account: account.view,
  huly,
  trackerUrl: credentials === undefined ? null : issueUrlBase(credentials),
  launches: launchDays(launches, new Date(), LAUNCH_CHART_DAYS),
  taskSessions: taskSessions(launches, sessions),
  context: config.context,
})

const server = createBatonServer({
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
})

setInterval(() => hub.broadcast('ping', { at: new Date().toISOString() }), 15_000).unref()

setInterval(() => dispatcher.check(), LIMIT_CHECK_MS).unref()

monitor.start()
limits.start()
account.start()

server.listen(config.port, config.host, () => {
  console.log(`baton listening on http://${config.host}:${config.port}`)
})

if (credentials === undefined) {
  console.log('huly: HULY_* variables are not set, tracker is off')
} else {
  const link = new HulyLink({
    connect: () => connectHuly(credentials, HULY_TIMEOUT_MS),
    timeoutMs: HULY_TIMEOUT_MS,
    onHealth: (health) => {
      huly = health
      hub.broadcast('state', getState())
    },
  })
  huly = link.health
  const report = (error: unknown) => console.error(`huly: ${error instanceof Error ? error.message : String(error)}`)

  const poller = new StatusPoller({
    link,
    watched: () => [...tasksByProject.values()].flat().map((task) => task.id),
    intervalMs: HULY_POLL_MS,
    onChange: (changes) => {
      const byId = new Map(changes.map((change) => [change.id, change.to]))
      for (const [project, tasks] of tasksByProject) {
        if (!tasks.some((task) => byId.has(task.id))) continue
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

  const refreshTasks = async (): Promise<void> => {
    await Promise.all(
      Object.keys(config.projects).map(async (project) => {
        try {
          const tasks = await link.run((source) => source.chainTasks(project))
          tasksByProject.set(project, tasks)
          dispatcher.setTasks(project, tasks)
        } catch (error) {
          report(error)
        }
      }),
    )
    hub.broadcast('state', getState())
    poller.start()
    setTimeout(() => void refreshTasks(), tasksByProject.size === 0 ? HULY_POLL_MS : TASKS_REFRESH_MS)
  }
  void refreshTasks()
}
