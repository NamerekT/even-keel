export { wireMemory, wirePackageHub, briefOn } from './account-packages.js'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { KEY_CHECK_MS, KEY_CHECK_TIMEOUT_MS, CREDIT_CHECK_MS, KEY_CHECKS, CREDIT_CHECKS, APP_POLL_MS, LOGIN_TIMEOUT_MS, CLOUD_CHECK_PROMPT, CLOUD_CHECK_TIMEOUT_MS } from '../account/service-defaults.js'
import { currentUser, readAwsProfiles } from '../account/aws.js'
import { readGcloud } from '../account/gcloud.js'
import { readAzure } from '../account/azure.js'
import { DaemonRefresh } from '../account/daemon.js'
import { keyProvider, type AccountHome } from '../account/homes.js'
import { accountAt, forgetAccount, formerOwner, markRemoving, nameAccount, noteAccount } from '../account/ledger.js'
import { forgetKeyOrganization, saveKeyOrganization } from '../account/organizations.js'
import { forgetManagementKey, readOpenRouterBalance, saveManagementKey } from '../account/management.js'
import { transportOf } from '../account/transport.js'
import { liveSessions, loginBlock, type LoginBlock } from '../account/model.js'
import { currentAccount } from '../account/current.js'
import { answers, Reachability } from '../account/network.js'
import { VsCodeAccount, vscodeSettingsFile } from '../account/vscode.js'
import { AccountWatcher } from '../account/watcher.js'
import { AGENTS } from '../agent/adapters.js'
import type { Agent, SessionHandle, SessionStart } from '../agent/contract.js'
import { sessionBase, sessionEnv, sessionSecrets, settingsSecrets } from '../agent/env.js'
import { ModelCatalog } from '../agent/models.js'
import { VersionWatcher } from '../agent/versions.js'
import { CLAUDE } from '../claude/name.js'
import { untrustedStart } from '../claude/trust.js'
import { CODEX } from '../codex/name.js'
import { chainWindowOf, type WindowKey } from '../codex/window.js'
import { OPENCODE } from '../opencode/name.js'
import { folderVendor } from '../opencode/home.js'
import { installForProfiles } from '../huly/client.js'
import { handoffsOf } from '../chain/launches.js'
import { withUnattended } from '../chain/relay.js'
import { isChatSession } from '../chats/model.js'
import { isPlain, localUrlOf, type EvenKeelConfig, ownerOf, poolEntries, projectLabel, projectsByAccount, providersInUse, readerIds, runSettings } from '../config.js'
import { saveLimits } from '../limits/saved.js'
import { runOf } from './demo.js'
import { LimitsWatcher } from '../limits/watcher.js'
import { notice, NoticeError, type Notice } from '../notice/notice.js'
import { readJson } from '../packages/plugins.js'
import { secretCatalog } from '../secrets/catalog.js'
import { Secrets } from '../secrets/service.js'
import { settleMail } from '../sessions/mailRelay.js'
import { isLive, lampOf, turnStatus } from '../sessions/agents.js'
import { launchPlan, runChoice, type LaunchPlan, type RunChoice, type RunSettings, type VendorOf } from '../sessions/launch.js'
import { effortFor, type TaskRun } from '../sessions/runs.js'
import { taskMark } from '../sessions/orphans.js'
import { agentOfSession, liveViewOf, steers } from '../sessions/view-index.js'
import { home as dataHome, inContainer, root, source } from '../locations.js'
import { checkProfileRules } from '../profiles/rules.js'
import { disabledNotice, Profiles } from '../profiles/service.js'
import type { SessionView } from '../state.js'
import { SQLITE_VERSIONS, STEPS as DATABASE_STEPS } from '../storage/database.js'
import { SCHEMA_VERSION } from '../storage/schema.js'
import { TALLY_SCHEMA_VERSION } from '../stats/tally-schema.js'
import { runLabelText } from '../tracker/model.js'
import { stateUrlOf, Updater } from '../updates/updater.js'
import { runsAsService } from '../updates/control.js'
import { UpdateWatcher } from '../updates/watcher.js'
import { firstRun } from '../setup.js'
import { PassMemo } from '../pass-memo.js'
import type { ServiceContext } from '../service.js'
import type { MachineContext } from './machine-context.js'

export { logStartupDialogs, wireContextWindows, wireMonitor, wireOwners } from './session-monitor.js'

export type AccountsContext = Pick<ServiceContext,
  | 'journal'
  | 'ACCOUNT_POLL_MS'
  | 'AGENT_TIMEOUT_MS'
  | 'CLI_VERSION_POLL_MS'
  | 'LIMITS_POLL_MS'
  | 'NETWORK_PROBE_MS'
  | 'OFFLINE_RETRY_MS'
  | 'OWNERS_RESCAN_MS'
  | 'PLUGIN_UPDATE_TIMEOUT_MS'
  | 'SESSION_POLL_MS'
  | 'TRACKER_CHECK_MS'
  | 'UPDATE_POLL_MS'
  | 'USAGE_POLL_MS'
  | 'WINDOW_RECHECK_MS'
  | 'account'
  | 'activeAccount'
  | 'agentOf'
  | 'agents'
  | 'accountSettings'
  | 'agentsRead'
  | 'approvals'
  | 'branchOf'
  | 'briefOn'
  | 'chatTitles'
  | 'choiceFor'
  | 'ciOn'
  | 'ciTokenOf'
  | 'ciWatches'
  | 'claudeConfigs'
  | 'cliLease'
  | 'cliCopies'
  | 'cliVersions'
  | 'configStore'
  | 'contextWindows'
  | 'daemons'
  | 'db'
  | 'demo'
  | 'dispatcher'
  | 'emailAt'
  | 'envFile'
  | 'machineDb'
  | 'getState'
  | 'hasAccount'
  | 'homeOf'
  | 'homes'
  | 'hub'
  | 'importedProfiles'
  | 'keyOrganizations'
  | 'keySpend'
  | 'runOfTask'
  | 'setTaskRun'
  | 'ledger'
  | 'limitRetries'
  | 'limits'
  | 'limitsFile'
  | 'linkOf'
  | 'listen'
  | 'liveView'
  | 'lockedReaders'
  | 'logStartupDialogs'
  | 'mailRelay'
  | 'machineLink'
  | 'machineChanged'
  | 'managementKeys'
  | 'mcpPort'
  | 'memory'
  | 'models'
  | 'monitor'
  | 'online'
  | 'owners'
  | 'packages'
  | 'profileKindsOf'
  | 'profiles'
  | 'projectOf'
  | 'promptLanguage'
  | 'protectionAudit'
  | 'pullReadinessOf'
  | 'pullRefusals'
  | 'pullRequestsOn'
  | 'readerRules'
  | 'readerTasks'
  | 'readers'
  | 'refreshProject'
  | 'release'
  | 'remotes'
  | 'requireModel'
  | 'runtimes'
  | 'saveAccounts'
  | 'savedLimits'
  | 'sayBlankedSecrets'
  | 'secretsSaid'
  | 'sessions'
  | 'settingsFor'
  | 'spendsByKey'
  | 'startedAt'
  | 'stateDir'
  | 'stopLingering'
  | 'tallyMode'
  | 'trackers'
  | 'vscode'
  | 'wedgedSessions'
  | 'writes'
>

export function wireRuntimes(ctx: MachineContext): Map<string, Agent> {
  return new Map<string, Agent>(
    Object.entries(AGENTS).map(([name, adapter]) => [
      name,
      adapter.setup({
        env: () => sessionEnv(process.env, ctx.packages.keyNames(), localUrlOf(ctx.listen), ctx.envFile.own()),
        timeoutMs: ctx.AGENT_TIMEOUT_MS,
        workDir: ctx.stateDir,
        checkedCli: () => ctx.configStore.current.cli[name] !== 'system',
        log: (line) => console.log(line),
        onCliChange: () => { void ctx.cliVersions.check(); ctx.machineChanged() },
        onCliFailure: () => { ctx.configStore.fallBackCli(name) },
        onCliProgress: () => ctx.machineChanged(),
        transport: (home): string | null => transportOf(home.agent, ctx.configStore.current.execution[CLAUDE], ctx.account.apiKey(home.key)),
        unattended: () => ctx.configStore.current.unattended,
        language: () => ctx.configStore.current.language ?? ctx.promptLanguage(),
        onLimits: (key, reported, at) => ctx.limits.report(key, reported, at),
      }),
    ]),
  )
}

export function wireModels(ctx: MachineContext): ModelCatalog {
  return new ModelCatalog({
    list: async (home) => (await ctx.agentOf(home).models?.(home)) ?? null,
    title: (home) => AGENTS[home.agent]!.title,
    name: (home) => ctx.account.view.accounts.find((entry) => entry.key === home.key)?.name ?? home.key,
    now: () => Date.now(),
    log: (line) => console.warn(line),
  })
}

export function wireRequireModel(ctx: MachineContext): (home: AccountHome, start: SessionStart) => Promise<void> {
  return async (home: AccountHome, start: SessionStart) => {
    const refusal = await ctx.models.refusal(home, start.name, start.model)
    if (refusal !== undefined) throw new NoticeError(refusal)
  }
}

export function wireSayBlankedSecrets(ctx: MachineContext): (home: AccountHome) => void {
  return (home: AccountHome) => {
    const names = settingsSecrets(readJson(join(home.dir, 'settings.json')), sessionSecrets(ctx.packages.keyNames())).join(', ')
    if (ctx.secretsSaid.get(home.key) === names) return
    ctx.secretsSaid.set(home.key, names)
    if (names !== '') console.log(`launch: the env of account ${home.key}'s settings.json sets ${names}; chain sessions get them blank`)
  }
}

export function wireLaunchIn(ctx: MachineContext): (home: AccountHome, start: SessionStart, project: string | undefined) => Promise<string> {
  return async (home: AccountHome, start: SessionStart, project: string | undefined) => {
    const blocked = ctx.cliCopies.blocked(home.agent)
    if (blocked) throw new NoticeError(blocked)
    await ctx.requireModel(home, start)
    if (home.agent === CLAUDE && start.settings !== undefined) ctx.sayBlankedSecrets(home)
    const trusted = withTrust(ctx, start, project)
    await ctx.keySpend.beforeTurn(home.key)
    try {
      return listening(ctx, start, await ctx.cliLease.session(home, () => ctx.agentOf(home).launch(home, trusted)))
    } catch (error) {
      const folder = trusted.trustedRepo
      const place = folder === undefined ? null : { task: start.name, folder, platform: process.platform, user: userInfo().username, service: await runsAsService() }
      throw (place === null ? null : untrustedStart(error, place, ctx.stateDir)) ?? error
    }
  }
}

export function wireResumeIn(ctx: MachineContext): (home: AccountHome, session: SessionHandle, start: SessionStart) => Promise<string> {
  return async (home: AccountHome, session: SessionHandle, start: SessionStart) => {
    const blocked = ctx.cliCopies.blocked(home.agent)
    if (blocked) throw new NoticeError(blocked)
    await ctx.requireModel(home, start)
    const project = ctx.projectOf(start.name)
    const trusted = withTrust(ctx, start, project)
    await ctx.keySpend.beforeTurn(home.key)
    try {
      return listening(ctx, start, await ctx.cliLease.session(home, () => ctx.agentOf(home).resume(home, session, trusted)))
    } catch (error) {
      const folder = trusted.trustedRepo
      const place = folder === undefined ? null : { task: start.name, folder, platform: process.platform, user: userInfo().username, service: await runsAsService() }
      throw (place === null ? null : untrustedStart(error, place, ctx.stateDir)) ?? error
    }
  }
}

/**
 * A session started with the built-in plugin takes the chat's mail from its turn's start (BTN-1430): a message right
 * after the one that started it waits in the mailbox instead of being refused before the hooks first ask.
 */
function listening(ctx: MachineContext, start: SessionStart, sessionId: string): string {
  if (ctx.packages.bringsMail(start.plugins)) ctx.mailbox.expect(sessionId)
  return sessionId
}

/**
 * `listening` again after a restart (BTN-1506), from what outlives it: a session the machine's launch journal names, by
 * the pin its task's last start left; a project chat's, by the built-in plugin every chat starts with.
 */
export function wireStartedWithMail(ctx: Pick<MachineContext, 'journal' | 'sessions' | 'packages'>): (sessionId: string) => boolean {
  return (sessionId) => {
    const run = handoffsOf(ctx.journal, sessionId)
    if (run !== undefined) return ctx.packages.pinsMail(run.project, run.task)
    return isChatSession(ctx.sessions, sessionId) && ctx.packages.chatsMail()
  }
}

function withTrust(ctx: MachineContext, start: SessionStart, project: string | undefined): SessionStart {
  const config = ctx.configStore.current
  const folder = project === undefined ? undefined : config.projects[project]
  return { ...start, trustedRepo: folder, ...(project === undefined ? {} : { mark: taskMark(project, start.name) }) }
}

export function wireLimits(ctx: MachineContext): LimitsWatcher {
  return new LimitsWatcher({
    file: ctx.limitsFile,
    intervalMs: ctx.LIMITS_POLL_MS,
    homes: () => ctx.homes.list(),
    ownerOf: (configDir) => ctx.homes.ownerOf(configDir),
    usage: (home) => {
      const { usage } = ctx.agentOf(home)
      return usage === undefined ? undefined : (at) => usage(home, at)
    },
    limitsHidden: (home) => ctx.agentOf(home).limitsHidden?.(home) === true,
    usageIntervalMs: ctx.USAGE_POLL_MS,
    online: ctx.online,
    offlineRetryMs: ctx.OFFLINE_RETRY_MS,
    notBefore: (key) => ctx.ledger.accounts[key]?.since ?? null,
    accessExpired: (home) => {
      const { accessExpiresAt } = ctx.homes.times(home)
      return accessExpiresAt !== null && accessExpiresAt <= Date.now()
    },
    ready: (): boolean => ctx.account.ready,
    apiKey: ctx.spendsByKey,
    needsLogin: (key) => ctx.account.needsLogin(key),
    longToken: (key) => {
      const token = ctx.account.longToken(key)
      if (token === undefined) return undefined
      // A folder since removed or put on a token itself is no source of limits any more.
      const same = token.sameAs === undefined ? undefined : ctx.homes.find(token.sameAs)
      return { sameAs: same !== undefined && ctx.account.longToken(same.key) === undefined ? same.key : undefined }
    },
    saved: ctx.savedLimits,
    save: (key, limits) => ctx.writes.add(`the limits of ${key}`, saveLimits(ctx.machineDb, key, limits)),
    ...(ctx.planFirst === true && { planFirst: true }),
    onChange: () => {
      ctx.machineChanged()
    },
    onError: (error) => console.error(`limits:${error instanceof Error ? error.message : String(error)}`),
  })
}

export function wireUpdates(ctx: AccountsContext): UpdateWatcher {
  return new UpdateWatcher({
    repo: ctx.release.repo,
    current: ctx.release.version,
    // The demo's project is none of the person's: the first run lasts through the demo (BTN-776).
    enabled: () => ctx.configStore.current.updates.check && !firstRun(ctx.tallyMode(), Object.keys(ctx.configStore.current.projects).filter((id) => !ctx.demo.owns(id)).length),
    intervalMs: ctx.UPDATE_POLL_MS,
    onChange: () => ctx.hub.broadcastSoon('state', ctx.getState),
    log: (line) => console.log(line),
  })
}

export function wireUpdater(ctx: AccountsContext): Updater {
  return new Updater({
    container: inContainer,
    root,
    home: dataHome,
    source,
    packageName: ctx.release.name,
    current: ctx.release.version,
    storage: { schema: SCHEMA_VERSION, database: SQLITE_VERSIONS + DATABASE_STEPS.length, tally: TALLY_SCHEMA_VERSION },
    startedAt: ctx.startedAt,
    active: () => ctx.dispatcher.state.active,
    stateUrl: () => stateUrlOf(ctx.listen.host, ctx.listen.port),
    onChange: () => ctx.hub.broadcastSoon('state', ctx.getState),
    log: (line) => console.log(line),
  })
}

export function wireCliVersions(ctx: MachineContext): VersionWatcher {
  return new VersionWatcher({
    agents: () =>
      [...ctx.runtimes].flatMap(([name, agent]) => {
        // The CLI on the machine, not the copy sessions may run on: the page's "Yours, X" is its version (BTN-622).
        const version = agent.system?.version ?? agent.version?.bind(agent)
        if (version === undefined) return []
        const installed = () => (agent.system?.installed() ?? agent.installed?.()) !== false
        const runsOnInstalled = () => {
          const config = ctx.configStore.current
          const own = config.cli[name] === 'system' || Boolean(process.env[`EVEN_KEEL_${name.toUpperCase()}_BIN`])
          return own && providersInUse(config, Object.keys(config.projects)).has(name)
        }
        return [{ name, title: AGENTS[name]!.title, checked: AGENTS[name]!.checked, installed, version, prune: () => agent.cli?.prune() ?? Promise.resolve(), runsOnInstalled }]
      }),
    intervalMs: ctx.CLI_VERSION_POLL_MS,
    onChange: () => ctx.machineChanged(),
    log: (line) => console.log(line),
  })
}

export function wireDaemons(ctx: MachineContext): DaemonRefresh {
  return new DaemonRefresh({
    share: (home) => ctx.homes.share(home),
    running: async (home) => liveSessions(await ctx.agentOf(home).sessions(home), home.key).length,
    daemon: async (home) => {
      const agent = ctx.agentOf(home)
      const wanted = agent.pinned?.() ?? null
      const running = wanted === null ? null : ((await agent.daemonVersion?.(home)) ?? null)
      return running === null ? null : { running, wanted: wanted! }
    },
    stopDaemon: async (home) => ctx.agentOf(home).stopDaemon?.(home),
    onChange: () => ctx.machineChanged(),
    onError: (error) => console.error(`account: ${error instanceof Error ? error.message : String(error)}`),
  })
}

export function wireSecrets(ctx: AccountsContext): Secrets {
  return new Secrets({
    catalog: secretCatalog(),
    envFile: join(dataHome, '.env'),
    settingsFile: () => join(ctx.homes.global.dir, 'settings.json'),
    env: process.env,
    outer: (name) => ctx.envFile.isOuter(name),
    applied: () => ctx.envFile.reload(),
    host: () => ctx.listen.host,
    expired: () => void ctx.daemons.expire(ctx.homes.global),
    sessionsPending: () => ctx.daemons.pending(ctx.homes.global.key),
    onChange: () => ctx.hub.broadcastSoon('state', ctx.getState),
  })
}

export function wireProfiles(ctx: AccountsContext): Profiles {
  return new Profiles({
    db: ctx.db,
    writes: ctx.writes,
    kinds: ctx.profileKindsOf,
    set: ctx.importedProfiles,
    // Feeds too (BTN-66): a profile a feed reads on is in use, and its kind is checked like a project's.
    projects: () => {
      const { keys, trackers: kinds, owners } = ctx.readers()
      return Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, { key, kind: kinds[id]!, feed: owners[id] !== undefined }]))
    },
    locked: () => ctx.lockedReaders(),
    settingsFile: () => join(ctx.homes.global.dir, 'settings.json'),
    expired: () => void ctx.daemons.expire(ctx.homes.global),
    ci: (id) => ctx.ciOn(id, false),
    hiddenCi: (id) => ctx.ciOn(id, true),
    checkRules: (set, id, rules) => checkProfileRules(ctx.configStore.current, set, id, rules),
    deniedPulls: (id) => ctx.pullRefusals.of(id, (project, target) => (ctx.pullRequestsOn(project) ? ctx.ciTokenOf(project, target) : null)),
    // A feed's chain is its project's; a queued chain counts too (BTN-830).
    chains: (readers) => {
      const { active, queue } = ctx.dispatcher.state
      const running = new Set([...active.map((chain) => chain.project), ...queue])
      const owners = [...new Set(readers.map((reader) => ownerOf(ctx.readers(), reader)))]
      return owners.filter((project) => running.has(project)).map((id) => ({ id, label: projectLabel(ctx.configStore.current, id) }))
    },
    timeoutMs: ctx.TRACKER_CHECK_MS,
    log: (line) => console.log(line),
    onChange: (set) => {
      installForProfiles(set.profiles)
      ctx.trackers.apply(ctx.readers(), set)
      ctx.ciWatches.tokensChanged()
      void ctx.ciWatches.refresh()
      ctx.packages.retryProbes()
      ctx.dispatcher.check()
      ctx.hub.broadcastSoon('state', ctx.getState)
    },
    onCheck: () => {
      ctx.dispatcher.check()
      ctx.hub.broadcastSoon('state', ctx.getState)
    },
  })
}

export function wireVscode(ctx: MachineContext): VsCodeAccount {
  return new VsCodeAccount({
    file: vscodeSettingsFile(process.env),
    homes: () => ctx.homes.list(),
    ownerOf: (dir) => ctx.homes.ownerOf(dir),
    records: async (home) => (await ctx.agentOf(home).liveRecords?.(home)) ?? [],
    title: (home, sessionId) => ctx.chatTitles.of(join(home.dir, 'projects'), sessionId),
    intervalMs: APP_POLL_MS,
    onChange: () => ctx.machineChanged(),
    onError: (error) => console.error(`vscode: ${error instanceof Error ? error.message : String(error)}`),
  })
}

export function wireAccount(ctx: MachineContext): AccountWatcher {
  return new AccountWatcher({
    homes: ctx.homes,
    agentOf: ctx.agentOf,
    apps: {
      list: () => [ctx.vscode.view],
      refresh: () => ctx.vscode.refresh(),
      point: (_app, home) => ctx.vscode.point(home),
    },
    prepare: (home) => ctx.daemons.prepare(home),
    active: () => ctx.activeAccount(),
    activate: (key) => {
      ctx.configStore.saveActive(ctx.homes.find(key)?.agent ?? CLAUDE, key)
      ctx.machineChanged()
    },
    forget: (key) => ctx.saveAccounts(forgetAccount(ctx.ledger, key)),
    nameOf: (key) => ctx.ledger.accounts[key]?.name ?? null,
    signedInAs: (key) => ({ last: ctx.ledger.accounts[key]?.email ?? null, former: formerOwner(ctx.ledger, key) }),
    name: (key, name) => ctx.saveAccounts(nameAccount(ctx.ledger, key, name)),
    transportOf: (home, apiKey) => transportOf(home.agent, ctx.configStore.current.execution[CLAUDE], apiKey),
    loginBlock: (): LoginBlock | null => loginBlock(ctx.brief.active(), ctx.agents, ctx.activeAccount()),
    sessionsIn: (key) => liveSessions(ctx.agents, key),
    workingIn: (key) => ctx.agents.some((agent) => (agent.account ?? 'global') === key && !agent.resting && isLive(agent) && lampOf(agent, null) === 'working'),
    projectsOn: (key) => projectsByAccount(ctx.configStore.current, Object.keys(ctx.configStore.current.projects))[key] ?? [],
    pool: () => poolEntries(ctx.configStore.current, Object.keys(ctx.configStore.current.projects)),
    makeShared: (agent, key) => {
      ctx.configStore.saveSharedAccount(agent, key)
      console.log(`accounts: ${key} is the shared ${agent} account, the shared one named no folder`)
      ctx.machineChanged()
    },
    missing: () => [...ctx.runtimes].flatMap(([name, agent]) => (agent.installed?.() === false ? [name] : [])),
    online: ctx.online,
    sessionsKnown: () => ctx.agentsRead,
    removing: (key) => ctx.ledger.removing.includes(key),
    markRemoving: (key, on) => ctx.saveAccounts(markRemoving(ctx.ledger, key, on)),
    configPending: (key) => ctx.daemons.pending(key),
    settings: ctx.accountSettings,
    limits: (key) => ctx.limits.limits(key),
    usage: (key) => ctx.limits.usage(key),
    limitsOutdated: (key) => ctx.limits.outdated(key),
    lastLimit: (key) => ctx.limitRetries.lastAt(key),
    checkCloud: async (home) => {
      const write = ctx.agentOf(home).write
      if (write === undefined) throw new Error(`${home.agent} runs no one-off turn`)
      const answer = await write.call(ctx.agentOf(home), home, { cwd: home.dir, prompt: CLOUD_CHECK_PROMPT, model: null, timeoutMs: CLOUD_CHECK_TIMEOUT_MS })
      return { model: answer.spend.model }
    },
    // The cloud form reads what a session gets, not what Even Keel's `.env` put into the service (BTN-1120).
    awsProfiles: () => readAwsProfiles(sessionBase(process.env, ctx.packages.keyNames(), ctx.envFile.own())),
    gcloud: () => readGcloud(sessionBase(process.env, ctx.packages.keyNames(), ctx.envFile.own())),
    azure: () => readAzure(sessionBase(process.env, ctx.packages.keyNames(), ctx.envFile.own())),
    whose: () => ({ user: currentUser(), home: homedir() }),
    checkKey: (agent, key) => KEY_CHECKS[keyProvider(agent, key)](key, KEY_CHECK_TIMEOUT_MS),
    keyCheckMs: KEY_CHECK_MS,
    organizations: {
      of: (key) => ctx.keyOrganizations.get(key),
      note: (key, organization) => {
        ctx.keyOrganizations.set(key, organization)
        ctx.writes.add(`the organization of ${key}`, saveKeyOrganization(ctx.machineDb, key, organization, new Date()))
      },
      forget: (key) => {
        if (!ctx.keyOrganizations.delete(key)) return
        ctx.writes.add(`the organization of ${key}`, forgetKeyOrganization(ctx.machineDb, key))
      },
    },
    managementKeys: {
      of: (key) => ctx.managementKeys.get(key),
      save: (key, value) => {
        ctx.managementKeys.set(key, value)
        ctx.writes.add(`the management key of ${key}`, saveManagementKey(ctx.machineDb, key, value, new Date()))
      },
      forget: (key) => {
        if (!ctx.managementKeys.delete(key)) return
        ctx.writes.add(`the management key of ${key}`, forgetManagementKey(ctx.machineDb, key))
      },
    },
    readBalance: (key) => readOpenRouterBalance(key, KEY_CHECK_TIMEOUT_MS),
    checkCredit: (agent, key) => CREDIT_CHECKS[keyProvider(agent, key)](key, KEY_CHECK_TIMEOUT_MS),
    creditCheckMs: CREDIT_CHECK_MS,
    intervalMs: ctx.ACCOUNT_POLL_MS,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
    now: () => new Date(),
    onChange: () => {
      let changed = false
      for (const entry of ctx.account.view.accounts) {
        const noted = noteAccount(ctx.ledger, entry.key, entry.status?.loggedIn === true ? entry.status.email : undefined, new Date())
        if (noted === undefined) continue
        ctx.saveAccounts(noted)
        changed = true
      }
      if (changed || ctx.limits.deferred) ctx.limits.refresh()
      ctx.machineChanged()
    },
    onError: (error) => console.error(`account: ${error instanceof Error ? error.message : String(error)}`),
  })
}

export function wireAgentOf(ctx: MachineContext): (home: AccountHome) => Agent {
  return (home: AccountHome): Agent => ctx.runtimes.get(home.agent)!
}

export function wireEnvOf(ctx: MachineContext): (home: AccountHome) => NodeJS.ProcessEnv {
  return (home: AccountHome) => ctx.agentOf(home).env(home)
}

export function wireStopIn(ctx: MachineContext): (home: AccountHome, session: SessionHandle) => Promise<void> {
  return (home: AccountHome, session: SessionHandle) => ctx.agentOf(home).stop(home, session)
}

export function wireEmailAt(ctx: MachineContext): (key: string, at: string | null) => string | null {
  return (key: string, at: string | null): string | null =>
    (at === null ? null : accountAt(ctx.ledger, key, at)) ?? ctx.account.emailOf(key)
}

export function wireSessionAccount(ctx: MachineContext): (sessionId: string | null, at: string | null) => string | null {
  return (sessionId: string | null, at: string | null): string | null => {
    if (sessionId === null) return null
    const live = ctx.sessions.find((view) => view.sessionId === sessionId)
    if (live !== undefined) return live.account
    const key = ctx.owners.of(sessionId)
    return key === undefined ? null : ctx.emailAt(key, at)
  }
}

export function wireAccountNow(ctx: MachineContext): (key?: string) => { id: string | null; ready: boolean; label: string; provider: string | undefined; } {
  return (key = ctx.account.view.active) => currentAccount(ctx.account.view, key)
}

export function wireLiveView(ctx: MachineContext): (task: string) => SessionView | undefined {
  return (task: string) => liveViewOf(ctx.sessions, task)
}

export function wireSteering(ctx: MachineContext): (sessionId: string) => boolean {
  return (sessionId: string) => steers(ctx.agents, sessionId)
}

export function wireAgentStatus(ctx: MachineContext): (task: string) => import("../sessions/agents.js").AgentStatus | undefined {
  return (task: string) => {
    const view = ctx.liveView(task)
    if (view === undefined) return undefined
    if (ctx.monitor.holds.turning(view.sessionId, view.ask?.id ?? null)) return 'busy'
    const agent = agentOfSession(ctx.agents, view.sessionId)
    const handoff = ctx.monitor.handoff(task)
    const marked = view.checkpoint || (handoff?.sessionId === view.sessionId && (handoff.pullRequest ?? null) !== null)
    return turnStatus(agent?.status, view.lastActivityAt, new Date(), view.lamp === 'limit', agent?.state === 'blocked', marked)
  }
}

export function wireHasAccount(ctx: MachineContext): (provider: string, key: string) => boolean {
  return (provider: string, key: string) => ctx.homes.find(key)?.agent === provider
}

/** The OpenCode provider of an OpenCode folder of the pool, read from its `auth.json` at each launch: a sign-in may change. */
function vendorOfHome(ctx: Pick<AccountsContext, 'homes'>, memo?: PassMemo): VendorOf {
  return (provider, key) => {
    const home = provider === OPENCODE ? ctx.homes.find(key) : undefined
    if (home === undefined) return null
    return memo === undefined ? folderVendor(home.dir) : memo.of(`vendor\n${home.dir}`, () => folderVendor(home.dir))
  }
}

export interface ChoiceFor {
  (project: string | undefined, task?: string): RunChoice
  /**
   * Runs `body` with each choice computed once: one computation of the machine's facts asks for the same one up to
   * six times per project and task, and an OpenCode choice reads its folder's `auth.json`.
   */
  pass<T>(body: () => T): T
}

/** The hub's config as a launch reads it: the service's store, or the machine's copy of the hub's brief. */
type ConfigView = { readonly current: EvenKeelConfig }

/** What a launch's choice reads: the task's own run, the project's settings and the account folders of this machine. */
export type ChoiceContext = Pick<AccountsContext, 'homes' | 'hasAccount' | 'projectOf'> & {
  configStore: ConfigView
  runOfTask: (project: string | undefined, task: string) => TaskRun | undefined
  demo: { owns(project: string | undefined): boolean }
  /**
   * On a machine, the own one too, its folder of the account the hub's folder `key` is of (`folderHere`, BTN-1311);
   * `null` — none here. Absent for the hub's own reads of its config, which names its own folders.
   */
  folderOf?: (key: string) => string | null
}

interface RunHere {
  settings: RunSettings
  has: (provider: string, account: string) => boolean
  /** By provider, the hub's folder this machine has no folder of the same account for. */
  absent: Map<string, string>
}

/**
 * The project's run settings with each provider's folder this machine's own of the same account. A provider without one
 * keeps its choice, so a task's run does not fall back to another agent here: the choice says the folder is absent.
 */
function runHere(ctx: ChoiceContext, project: string | undefined, folderOf = ctx.folderOf): RunHere {
  const settings = runOf(ctx, project)
  const absent = new Map<string, string>()
  if (folderOf === undefined) return { settings, has: ctx.hasAccount, absent }
  const accounts = Object.fromEntries(Object.entries(settings.accounts).map(([provider, key]) => {
    const here = folderOf(key)
    if (here === null) absent.set(provider, key)
    return [provider, here ?? '']
  }))
  return { settings: { ...settings, accounts }, has: (provider, account) => absent.has(provider) || ctx.hasAccount(provider, account), absent }
}

function withAbsent<T extends RunChoice>(choice: T, absent: Map<string, string>): T {
  const key = absent.get(choice.provider)
  return key === undefined ? choice : { ...choice, absent: key }
}

export function wireChoiceFor(ctx: ChoiceContext): ChoiceFor {
  const memo = new PassMemo()
  const vendorOf = vendorOfHome(ctx, memo)
  const { folderOf } = ctx
  // A pass asks for every task of a project (BTN-1317): the project's settings and each folder here are read once in it.
  const keptFolderOf = folderOf === undefined ? undefined : (key: string) => memo.of(`folder\n${key}`, () => folderOf(key))
  const choiceFor = (project: string | undefined, task?: string): RunChoice =>
    memo.of(JSON.stringify(['choice', project, task]), () => {
      const here = memo.of(JSON.stringify(['here', project]), () => runHere(ctx, project, keptFolderOf))
      const run = task === undefined ? undefined : ctx.runOfTask(project ?? ctx.projectOf(task), task)
      return withAbsent(runChoice(run, here.settings, here.has, vendorOf), here.absent)
    })
  return Object.assign(choiceFor, { pass: <T>(body: () => T): T => memo.run(body) })
}

export function wirePlanFor(ctx: ChoiceContext & { unattended: () => boolean; promptLanguage: AccountsContext['promptLanguage'] }): (task: string, prompt: string, project?: string | undefined) => LaunchPlan {
  return (task: string, prompt: string, project = ctx.projectOf(task)): LaunchPlan => {
    const git = project === undefined || !isPlain(ctx.configStore.current, project)
    const full = withUnattended(prompt, ctx.unattended(), ctx.promptLanguage(project), git)
    const here = runHere(ctx, project)
    return withAbsent(launchPlan(ctx.runOfTask(project, task), full, here.settings, ctx.configStore.current.modelPrompts, here.has, vendorOfHome(ctx)), here.absent)
  }
}

type AgentExtras = Pick<SessionStart, 'bypassSandbox' | 'mcp' | 'plugins' | 'protection' | 'mainBranch' | 'contextWindow' | 'outsideRepo' | 'effort'>

/** The agents whose chain sessions take a window through `SessionStart.contextWindow`; Claude's goes in its settings. */
const WINDOW_KEYS: Readonly<Record<string, WindowKey>> = { [CODEX]: 'codexAutoCompactWindow', [OPENCODE]: 'openCodeAutoCompactWindow' }

export function wireAgentExtras(ctx: Pick<ChoiceContext, 'configStore' | 'runOfTask'> & Pick<AccountsContext, 'branchOf' | 'packages'>): (home: AccountHome, project: string | undefined, task: string) => AgentExtras {
  return (home: AccountHome, project: string | undefined, task: string): AgentExtras => {
    const key = WINDOW_KEYS[home.agent]
    const window = key === undefined ? undefined : chainWindowOf(ctx.configStore.current, project, key)
    const effort = effortFor(ctx.runOfTask(project, task), home.agent)
    return {
      ...(effort === null ? {} : { effort }),
      protection: (project === undefined ? undefined : ctx.configStore.current.settings[project]?.protection) ?? ctx.configStore.current.protection,
      ...(project === undefined ? {} : { mainBranch: ctx.branchOf(project) }),
      ...(home.agent !== CLAUDE && ctx.configStore.current.execution[home.agent] === 'bypass' ? { bypassSandbox: true } : {}),
      ...(project === undefined ? {} : ctx.packages.startOf(project, task, home.agent)),
      ...(window === undefined ? {} : { contextWindow: window }),
      ...(project !== undefined && isPlain(ctx.configStore.current, project) ? { outsideRepo: true } : {}),
    }
  }
}

export function wireNoAccountFor(): (task: string, fallback: string, provider: string) => Notice {
  return (task: string, fallback: string, provider: string) =>
    notice('chain.noAccountFor', {
      task,
      label: runLabelText({ provider: fallback, model: null }),
      provider: runLabelText({ provider, model: null }),
    })
}

export function wireReach(ctx: MachineContext): Reachability {
  return new Reachability({
    probe: (url) => answers(url, ctx.NETWORK_PROBE_MS),
    ttlMs: ctx.OFFLINE_RETRY_MS,
    now: () => Date.now(),
    onChange: (url, up) => console.log(up ? `network: ${url} answers again` : `network: ${url} does not answer; account checks and /usage wait for it`),
  })
}

export function wireProfileBlock(ctx: AccountsContext): (project: string) => Notice | undefined {
  return (project: string): Notice | undefined => {
    const off = disabledBlock(ctx, project)
    if (off !== undefined) return off
    const refused = ctx.profiles.refused(project)
    return refused === undefined ? undefined : notice('profiles.paused', { profile: refused.name, project: projectLabel(ctx.configStore.current, project) })
  }
}

/** The project, or one of its feeds, reads on a turned-off profile (BTN-830): its chain does not start. */
export function disabledBlock(ctx: Pick<AccountsContext, 'profiles' | 'configStore'>, project: string): Notice | undefined {
  const readers = readerIds(ctx.configStore.current, project)
  const off = readers.map((reader) => ctx.profiles.disabledFor(reader)).find((profile) => profile !== undefined)
  return disabledNotice(off, projectLabel(ctx.configStore.current, project))
}

export function wirePullBlock(ctx: AccountsContext): (project: string) => Notice | undefined {
  return (project: string): Notice | undefined => {
    const urls = ctx.remotes.urls[project]
    if (!ctx.pullRequestsOn(project) || urls === undefined) return undefined
    const ready = ctx.pullReadinessOf(project, urls)
    return 'notice' in ready ? notice('review.notReady', { project }, { cause: ready.notice }) : undefined
  }
}
