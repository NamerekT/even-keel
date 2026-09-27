import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { accountAt, loadLedger, noteAccount, saveLedger } from './account/ledger.js'
import { launchBlock, loginBlock, type LoginBlock } from './account/model.js'
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
import { claudeConfigDir, ClaudeCli, resolveClaudeBinary } from './sessions/claude.js'
import type { AgentEntry } from './sessions/agents.js'
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
const cli = new ClaudeCli(() => resolveClaudeBinary(process.env), CLAUDE_TIMEOUT_MS)
const claudeDir = claudeConfigDir(process.env)
const startedAt = new Date().toISOString()
const tasksByProject = new Map<string, HulyTask[]>()
let sessions: SessionView[] = []
let agents: AgentEntry[] = []
let huly: HulyHealth = { state: 'off', lastOkAt: null, error: null }
const launches: LaunchEntry[] = readLaunches(launchesFile)
let ledger = loadLedger(accountFile)

const limits = new LimitsWatcher({
  file: limitsFile,
  intervalMs: LIMITS_POLL_MS,
  usage: () => cli.usage(stateDir),
  usageIntervalMs: USAGE_POLL_MS,
  notBefore: () => ledger.since,
  onChange: () => hub.broadcast('state', getState()),
  onError: (error) => console.error(`limits: ${error instanceof Error ? error.message : String(error)}`),
})

const account = new AccountWatcher({
  status: () => cli.authStatus(),
  login: () => cli.authLogin(),
  loginBlock: (): LoginBlock | null => loginBlock(dispatcher.state.active, agents),
  intervalMs: ACCOUNT_POLL_MS,
  loginTimeoutMs: LOGIN_TIMEOUT_MS,
  now: () => new Date(),
  onChange: () => {
    const status = account.view.status
    const noted = noteAccount(ledger, status?.loggedIn === true ? status.email : null, new Date())
    if (noted !== undefined) {
      ledger = noted
      saveLedger(accountFile, ledger)
      limits.refresh()
    }
    hub.broadcast('state', getState())
    dispatcher.check()
  },
  onError: (error) => console.error(`account: ${error instanceof Error ? error.message : String(error)}`),
})

const monitor = new SessionMonitor({
  cli,
  claudeDir,
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

const dispatcher = new Dispatcher(loadChainState(chainFile), {
  projects: Object.keys(config.projects),
  launch: async (project, task) => (await cli.launch(task, config.projects[project]!)).sessionId,
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
  account: () => ({
    email: account.view.status?.email ?? null,
    ready: account.view.status?.loggedIn === true && launchBlock(account.view) === undefined,
  }),
  accountAt: (at) => accountAt(ledger, at),
  limitReset: () => exhaustedReset(limits.limits),
  resume: async (task, session) => {
    await cli.stop(session.agentId, session.sessionId)
    return (await cli.resume(session.sessionId, task, session.cwd, RESUME_PROMPT)).sessionId
  },
  relay: async (task, session, prompt) => {
    await cli.stop(session.agentId, session.sessionId)
    return (await cli.launch(task, session.workdir, prompt)).sessionId
  },
})

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
  limits: limits.limits,
  usage: limits.usage,
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
  sessionRecord: (sessionId) => readSessionRecord(join(claudeDir, 'projects'), sessionId),
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
