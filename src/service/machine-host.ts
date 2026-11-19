import type { PGlite } from '@electric-sql/pglite'
import { openAccountHomes } from '../account/globals.js'
import type { AccountHomes } from '../account/homes.js'
import { loadLedger } from '../account/ledger.js'
import { loadManagementKeys } from '../account/management.js'
import { loadKeyOrganizations } from '../account/organizations.js'
import type { LaunchEntry } from '../chain/dispatcher.js'
import { CLAUDE } from '../claude/name.js'
import { AccountLease } from '../cli-check/lease.js'
import type { CheckHistory } from '../cli-check/scheduler.js'
import type { listenOf } from '../config.js'
import { limitRecovery } from '../limits/recovery.js'
import { loadSavedLimits } from '../limits/saved.js'
import type { loadEnv } from '../locations.js'
import { BriefCopy } from '../machine/brief.js'
import type { CliChoices } from '../machine/config.js'
import { machineValue } from '../machine/state.js'
import type { Packages } from '../packages/service.js'
import type { AgentEntry } from '../sessions/agents.js'
import type { KeepWarm } from '../sessions/keepwarm.js'
import { Lingering } from '../sessions/lingering.js'
import { Inboxes } from '../sessions/inboxes.js'
import { Mailbox } from '../sessions/mailbox.js'
import { ChatTitles } from '../sessions/title.js'
import type { SessionView } from '../state.js'
import { loadContextWindows } from '../storage/context-windows.js'
import type { Writes } from '../storage/database.js'
import { dropLeftFolder, loadLeftFolders, saveLeftFolder } from '../storage/left-folders.js'
import * as accounts from './accounts.js'
import { stopLingering } from './cleanup.js'
import * as cliCheck from './cli-check.js'
import {
  ACCOUNT_POLL_MS, AGENT_TIMEOUT_MS, CLI_VERSION_POLL_MS, LIMITS_POLL_MS, NETWORK_PROBE_MS, OFFLINE_RETRY_MS, OWNERS_RESCAN_MS,
  PLUGIN_UPDATE_TIMEOUT_MS, SESSION_POLL_MS, USAGE_POLL_MS, WINDOW_RECHECK_MS, WORK_TTL_MS,
} from './defaults.js'
import * as bootstrap from './machine-bootstrap.js'
import { wireKeepWarm, wirePlaces, wireWorks } from './machine-chain.js'
import { machineContext, type LaterTell, type MachineContext } from './machine-context.js'
import { wireMachinePackages } from './machine-packages.js'
import { join } from 'node:path'

/**
 * The objects of this host the machine's assembly runs on: accounts, sessions, packages and folders. None of them is the
 * hub's: the config, the chain's state, the trackers' lists, the state database and the page come in the brief.
 */
export interface MachineHost {
  listen: ReturnType<typeof listenOf>
  mcpPort: number
  stateDir: string
  envFile: ReturnType<typeof loadEnv>
  machineDb: PGlite
  /** A machine on the network: its limits watcher polls nothing before the hub's first plan (BTN-1247). */
  planFirst?: boolean
  AGENT_TIMEOUT_MS: typeof AGENT_TIMEOUT_MS
  LIMITS_POLL_MS: typeof LIMITS_POLL_MS
  USAGE_POLL_MS: typeof USAGE_POLL_MS
  OFFLINE_RETRY_MS: typeof OFFLINE_RETRY_MS
  CLI_VERSION_POLL_MS: typeof CLI_VERSION_POLL_MS
  ACCOUNT_POLL_MS: typeof ACCOUNT_POLL_MS
  OWNERS_RESCAN_MS: typeof OWNERS_RESCAN_MS
  WINDOW_RECHECK_MS: typeof WINDOW_RECHECK_MS
  SESSION_POLL_MS: typeof SESSION_POLL_MS
  NETWORK_PROBE_MS: typeof NETWORK_PROBE_MS
  PLUGIN_UPDATE_TIMEOUT_MS: typeof PLUGIN_UPDATE_TIMEOUT_MS
  WORK_TTL_MS: typeof WORK_TTL_MS
  keyOrganizations: Awaited<ReturnType<typeof loadKeyOrganizations>>
  managementKeys: Awaited<ReturnType<typeof loadManagementKeys>>
  savedLimits: Awaited<ReturnType<typeof loadSavedLimits>>
  mailbox: Mailbox
  /** The inbox sockets of this machine's Claude sessions, as their hooks report them (BTN-1322); in memory only. */
  inboxes: Inboxes
  limitsFile: string
  accountFile: string
  transcriptWatch: ReturnType<typeof bootstrap.assembleTranscriptWatch>
  homes: AccountHomes
  accountSettings: Awaited<ReturnType<typeof bootstrap.assembleAccountSettings>>
  claudeConfigs: ReturnType<typeof bootstrap.assembleClaudeConfigs>
  packages: Packages
  approvals: ReturnType<typeof bootstrap.assembleApprovals>
  runtimes: ReturnType<typeof accounts.wireRuntimes>
  agentOf: ReturnType<typeof accounts.wireAgentOf>
  envOf: ReturnType<typeof accounts.wireEnvOf>
  models: ReturnType<typeof accounts.wireModels>
  requireModel: ReturnType<typeof accounts.wireRequireModel>
  secretsSaid: Map<string, string>
  sayBlankedSecrets: ReturnType<typeof accounts.wireSayBlankedSecrets>
  cliLease: AccountLease
  launchIn: ReturnType<typeof accounts.wireLaunchIn>
  resumeIn: ReturnType<typeof accounts.wireResumeIn>
  stopIn: ReturnType<typeof accounts.wireStopIn>
  sessions: SessionView[]
  agents: AgentEntry[]
  /**
   * The monitor has read the sessions and their views once since the start. Until then a session's status is unknown,
   * not idle: the chain and the forward merges wait, and the account watcher keeps every folder (BTN-646).
   */
  agentsRead: boolean
  lingering: Lingering
  /**
   * The machine's own launch journal: the hub hands it the one it keeps at the start (`records.restore`), the machine adds
   * its launches. What runs on the machine reads this one, never the hub's launches (`docs/machines.md`, "One process").
   */
  journal: LaunchEntry[]
  gitFound: ReturnType<typeof bootstrap.assembleGitFound>
  ledger: ReturnType<typeof loadLedger>
  saveAccounts: ReturnType<typeof bootstrap.assembleSaveAccounts>
  homeOf: ReturnType<typeof bootstrap.assembleHomeOf>
  reach: ReturnType<typeof accounts.wireReach>
  keySpend: ReturnType<typeof bootstrap.assembleKeySpend>
  online: ReturnType<typeof bootstrap.assembleOnline>
  spendsByKey: ReturnType<typeof limitRecovery>['spendsByKey']
  limitRetries: ReturnType<typeof limitRecovery>['limitRetries']
  retryAfterLimit: ReturnType<typeof limitRecovery>['retryAfterLimit']
  limits: ReturnType<typeof accounts.wireLimits>
  cliVersions: ReturnType<typeof accounts.wireCliVersions>
  cliChecks: ReturnType<typeof cliCheck.wireCliChecks>
  daemons: ReturnType<typeof accounts.wireDaemons>
  cliCopies: Awaited<ReturnType<typeof bootstrap.assembleCliCopies>>
  chatTitles: ChatTitles
  vscode: ReturnType<typeof accounts.wireVscode>
  account: ReturnType<typeof accounts.wireAccount>
  owners: ReturnType<typeof accounts.wireOwners>
  emailAt: ReturnType<typeof accounts.wireEmailAt>
  sessionAccount: ReturnType<typeof accounts.wireSessionAccount>
  accountNow: ReturnType<typeof accounts.wireAccountNow>
  contextWindows: ReturnType<typeof accounts.wireContextWindows>
  monitor: ReturnType<typeof accounts.wireMonitor>
  wedgedSessions: Set<string>
  logStartupDialogs: (views: SessionView[]) => void
  liveView: ReturnType<typeof accounts.wireLiveView>
  agentStatus: ReturnType<typeof accounts.wireAgentStatus>
  hasAccount: ReturnType<typeof accounts.wireHasAccount>
  places: ReturnType<typeof wirePlaces>
  warmable: ReturnType<typeof bootstrap.assembleWarmable>
  keepWarm: KeepWarm
  works: ReturnType<typeof wireWorks>
  inHomes: ReturnType<typeof bootstrap.assembleInHomes>
  stopLingering: () => Promise<void>
}

export interface MachineHostInputs {
  machineDb: PGlite
  stateDir: string
  /** The writes the host's stores go behind: the hub's in its own process, the machine's on a machine of its own. */
  writes: Writes
  env: NodeJS.ProcessEnv
  envFile: ReturnType<typeof loadEnv>
  listen: () => ReturnType<typeof listenOf>
  mcpPort: () => number
  tell: LaterTell
  /** A machine on the network, which waits for the hub's plan of the account limits (`MachineHost.planFirst`). */
  planFirst?: boolean
  /** The account folders are open and nothing has read them yet: the hub's demo lists its folder here (BTN-776). */
  homesOpened?: (homes: AccountHomes) => void
}

export interface AssembledHost {
  host: MachineHost
  machine: MachineContext
}

/**
 * This host's half of the service (`docs/machines.md`, "The machine's context"), the same for the hub's own machine and
 * for a machine of its own (BTN-1247): what it runs on comes from `inputs`, what it reads of the hub from the brief, and
 * what it tells the hub goes through `inputs.tell`. Nothing is started here: the caller's lifecycle and ticks do it.
 */
export async function assembleMachineHost(inputs: MachineHostInputs): Promise<AssembledHost> {
  const { machineDb, stateDir, writes } = inputs
  const host: MachineHost = {
    get listen() { return inputs.listen() },
    get mcpPort() { return inputs.mcpPort() },
    stateDir,
    envFile: inputs.envFile,
    machineDb,
    ...(inputs.planFirst === true && { planFirst: true }),
    AGENT_TIMEOUT_MS,
    LIMITS_POLL_MS,
    USAGE_POLL_MS,
    OFFLINE_RETRY_MS,
    CLI_VERSION_POLL_MS,
    ACCOUNT_POLL_MS,
    OWNERS_RESCAN_MS,
    WINDOW_RECHECK_MS,
    SESSION_POLL_MS,
    NETWORK_PROBE_MS,
    PLUGIN_UPDATE_TIMEOUT_MS,
    WORK_TTL_MS,
    get keyOrganizations() { return keyOrganizations },
    get managementKeys() { return managementKeys },
    get savedLimits() { return savedLimits },
    get mailbox() { return mailbox },
    get inboxes() { return inboxes },
    get limitsFile() { return limitsFile },
    get accountFile() { return accountFile },
    get transcriptWatch() { return transcriptWatch },
    get homes() { return homes },
    get accountSettings() { return accountSettings },
    get claudeConfigs() { return claudeConfigs },
    get packages() { return packages },
    get approvals() { return approvals },
    get runtimes() { return runtimes },
    get agentOf() { return agentOf },
    get envOf() { return envOf },
    get models() { return models },
    get requireModel() { return requireModel },
    get secretsSaid() { return secretsSaid },
    get sayBlankedSecrets() { return sayBlankedSecrets },
    get cliLease() { return cliLease },
    get launchIn() { return launchIn },
    get resumeIn() { return resumeIn },
    get stopIn() { return stopIn },
    get sessions() { return sessions },
    set sessions(value) { sessions = value },
    get agents() { return agents },
    set agents(value) { agents = value },
    get agentsRead() { return agentsRead },
    set agentsRead(value) { agentsRead = value },
    get lingering() { return lingering },
    get journal() { return journal },
    get gitFound() { return gitFound },
    get ledger() { return ledger },
    set ledger(value) { ledger = value },
    get saveAccounts() { return saveAccounts },
    get homeOf() { return homeOf },
    get reach() { return reach },
    get keySpend() { return keySpend },
    get online() { return online },
    get spendsByKey() { return spendsByKey },
    get limitRetries() { return limitRetries },
    get retryAfterLimit() { return retryAfterLimit },
    get limits() { return limits },
    get cliVersions() { return cliVersions },
    get cliChecks() { return cliChecks },
    get daemons() { return daemons },
    get cliCopies() { return cliCopies },
    get chatTitles() { return chatTitles },
    get vscode() { return vscode },
    get account() { return account },
    get owners() { return owners },
    get emailAt() { return emailAt },
    get sessionAccount() { return sessionAccount },
    get accountNow() { return accountNow },
    get contextWindows() { return contextWindows },
    get monitor() { return monitor },
    get wedgedSessions() { return wedgedSessions },
    get logStartupDialogs() { return logStartupDialogs },
    get liveView() { return liveView },
    get agentStatus() { return agentStatus },
    get hasAccount() { return hasAccount },
    get places() { return places },
    get warmable() { return warmable },
    get keepWarm() { return keepWarm },
    get works() { return works },
    get inHomes() { return inHomes },
    get stopLingering() { return stopLingeringNow },
  }

  /** The organization each API account's key pays through (BTN-418), held in memory and written behind. */
  const keyOrganizations = await loadKeyOrganizations(machineDb)
  /** The management key of each OpenRouter account, for its balance (BTN-868), held in memory and written behind. */
  const managementKeys = await loadManagementKeys(machineDb)
  /** What polls and sessions last told of each account's limits before this start (BTN-631). */
  const savedLimits = await loadSavedLimits(machineDb)
  /** The context windows the agents named before this start, per launch and per session (BTN-946). */
  const savedWindows = await loadContextWindows(machineDb)
  // The machine's mailbox: its messages come from the hub at the link's start (`records.restore`).
  const mailbox = Mailbox.detached(writes, () => new Date())
  const inboxes = new Inboxes()
  const limitsFile = join(stateDir, 'rate-limits.json')
  const accountFile = join(stateDir, 'account.json')

  const machine = machineContext(host, new BriefCopy(), inputs.tell, (await machineValue(machineDb, 'cli') as CliChoices | undefined) ?? {})
  const transcriptWatch = bootstrap.assembleTranscriptWatch((sessionId) => inputs.tell.transcript(sessionId))
  const homes = await openAccountHomes(machineDb, inputs.env, 'machine_state')
  /** What the transfer wrote into each account folder's settings.json and each account's own layer (BTN-901), written behind. */
  const accountSettings = await bootstrap.assembleAccountSettings({ machineDb, homes, writes })
  homes.useSettings(accountSettings)
  inputs.homesOpened?.(homes)
  /** The shared pool's Claude entry: whose `.claude.json` and tools the Claude-only checks read. */
  const claudeAccount = () => machine.configStore.current.accounts[CLAUDE]!
  /** `.claude.json` files sessions read: the global one and that of a Claude account folder, the shared one by default. */
  const claudeConfigs = bootstrap.assembleClaudeConfigs({ claudeAccount, homes })
  const packages: Packages = wireMachinePackages(machine)
  const approvals = bootstrap.assembleApprovals(machine)
  const runtimes = accounts.wireRuntimes(machine)
  /** The agent of an account folder: every session of the folder runs on it. */
  const agentOf = accounts.wireAgentOf(machine)
  const envOf = accounts.wireEnvOf(machine)
  const models = accounts.wireModels(machine)
  /** A model the account does not have is refused here, before the agent starts a turn that dies on it (BTN-336). */
  const requireModel = accounts.wireRequireModel(machine)
  const secretsSaid = new Map<string, string>()
  /** Logs, once per account and list, the keys its `settings.json` sets that the chain's `--settings` blanks (BTN-436). */
  const sayBlankedSecrets = accounts.wireSayBlankedSecrets(machine)
  /** The account folders the automatic CLI check holds, and the chain launches it waits out (BTN-569). */
  const cliLease = new AccountLease((home) => account.view.accounts.find((entry) => entry.key === home.key)?.name ?? home.key)
  /** `project` — whose checkout a refusal of an untrusted folder names (BTN-429): its trust covers the task's worktree. */
  const launchIn = accounts.wireLaunchIn(machine)
  const resumeIn = accounts.wireResumeIn(machine)
  const stopIn = accounts.wireStopIn(machine)
  let sessions: SessionView[] = []
  let agents: AgentEntry[] = []
  let agentsRead = false
  const lingering = new Lingering()
  /** The worktree folders the cleanup left held before this start, tried again after the first read of the sessions (BTN-925). */
  lingering.restore(await loadLeftFolders(machineDb), {
    save: (folder) => writes.add(`the left folder ${folder.path}`, saveLeftFolder(machineDb, folder)),
    drop: (path) => writes.add(`the settled left folder ${path}`, dropLeftFolder(machineDb, path)),
  })
  const journal: LaunchEntry[] = []
  const gitFound = bootstrap.assembleGitFound(machine)
  gitFound.changed = () => inputs.tell.changed()
  let ledger = loadLedger(accountFile)
  const saveAccounts = bootstrap.assembleSaveAccounts(host)
  const homeOf = bootstrap.assembleHomeOf(host)
  const reach = accounts.wireReach(machine)
  /**
   * The real spend of chain sessions on an OpenRouter key, by its `usage` (BTN-860); the same read tells the account card
   * what is left of the key's own limit (BTN-847), and the account's balance is read beside it (BTN-868).
   */
  const keySpend = bootstrap.assembleKeySpend(machine)
  const online = bootstrap.assembleOnline(host)
  const { spendsByKey, limitRetries, retryAfterLimit } = limitRecovery({
    homeOf: (key) => homes.find(key),
    agentOf,
    apiKey: (key) => account.apiKey(key),
    creditBackAfter: (key, at, text) => account.creditBackAfter(key, at, text),
    limits: (key) => limits.limits(key),
    usage: (key) => limits.usage(key),
    spendMonth: (key, at) => limits.spendMonth(key, at),
  })
  const limits = accounts.wireLimits(machine)
  const cliVersions = accounts.wireCliVersions(machine)
  const cliChecks = cliCheck.wireCliChecks(machine, ((await machineValue(machineDb, 'cliCheck.history')) as CheckHistory | undefined) ?? {})
  const daemons = accounts.wireDaemons(machine)
  const cliCopies = await bootstrap.assembleCliCopies(machine)
  const chatTitles = new ChatTitles()
  const vscode = accounts.wireVscode(machine)
  const account = accounts.wireAccount(machine)
  const owners = accounts.wireOwners(machine)
  /** The e-mail a folder had at `at` (the folder's account may change), else its current one. */
  const emailAt = accounts.wireEmailAt(machine)
  const sessionAccount = accounts.wireSessionAccount(machine)
  /** The account folder `key` (the active one unless given) as the chain judges a launch in it. */
  const accountNow = accounts.wireAccountNow(machine)
  const contextWindows = accounts.wireContextWindows(machine, savedWindows)
  const monitor = accounts.wireMonitor(machine)
  const wedgedSessions = new Set<string>()
  const logStartupDialogs = (views: SessionView[]): void => accounts.logStartupDialogs(machine, views)
  const liveView = accounts.wireLiveView(machine)
  /** A session just resumed is mid-turn until the daemon shows it working, which lags the resume by seconds (BTN-307). */
  const agentStatus = accounts.wireAgentStatus(machine)
  /** A pool entry counts only while its folder exists and belongs to the provider it is filed under. */
  const hasAccount = accounts.wireHasAccount(machine)
  const places = wirePlaces(machine)
  /** The live view of the session a running chain will go on in, if its agent can ping a fork of it (BTN-437). */
  const warmable = bootstrap.assembleWarmable(host)
  const keepWarm: KeepWarm = wireKeepWarm(machine)
  // The machine posts its task folders from its first snapshot on.
  const works = wireWorks(machine)
  const inHomes = bootstrap.assembleInHomes(host)
  const stopLingeringNow = (): Promise<void> => stopLingering(machine)

  return { host, machine }
}
