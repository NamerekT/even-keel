import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { KEY_CHECK_MS, KEY_CHECK_TIMEOUT_MS, CREDIT_CHECK_MS, KEY_CHECKS, CREDIT_CHECKS, APP_POLL_MS, LOGIN_TIMEOUT_MS } from '../account/service-defaults.js'
import { DaemonRefresh } from '../account/daemon.js'
import { keyProvider, type AccountHome } from '../account/homes.js'
import { accountAt, forgetAccount, markRemoving, nameAccount, noteAccount } from '../account/ledger.js'
import { forgetKeyOrganization, saveKeyOrganization } from '../account/organizations.js'
import { transportOf } from '../account/transport.js'
import { liveSessions, loginBlock, type LoginBlock } from '../account/model.js'
import { currentAccount } from '../account/current.js'
import { answers, Reachability } from '../account/network.js'
import { VsCodeAccount, vscodeSettingsFile } from '../account/vscode.js'
import { AccountWatcher } from '../account/watcher.js'
import { AGENTS } from '../agent/adapters.js'
import type { Agent, SessionHandle, SessionStart } from '../agent/contract.js'
import { sessionBase, sessionSecrets, settingsSecrets } from '../agent/env.js'
import { ModelCatalog } from '../agent/models.js'
import { ContextWindows } from '../agent/windows.js'
import { VersionWatcher } from '../agent/versions.js'
import { CLAUDE } from '../claude/name.js'
import { untrustedStart } from '../claude/trust.js'
import { CODEX } from '../codex/name.js'
import { fixStem } from '../chain/fix.js'
import { withUnattended } from '../chain/relay.js'
import { idPrefixOf, ownerOf, poolEntries, projectLabel, projectsByAccount, runSettings } from '../config.js'
import { LimitsWatcher } from '../limits/watcher.js'
import { notice, NoticeError, type Notice } from '../notice/notice.js'
import { readJson } from '../packages/plugins.js'
import { Packages } from '../packages/service.js'
import { secretCatalog } from '../secrets/catalog.js'
import { Secrets } from '../secrets/service.js'
import { settleMail } from '../sessions/mailRelay.js'
import { isLive, lampOf, turnStatus } from '../sessions/agents.js'
import { launchPlan, runChoice, type LaunchPlan, type RunChoice } from '../sessions/launch.js'
import { SessionMonitor } from '../sessions/monitor.js'
import { TranscriptOwners } from '../sessions/owners.js'
import { home as dataHome, root, source } from '../locations.js'
import { keyPool, profileFor, serverProfile } from '../profiles/model.js'
import { checkProfileRules } from '../profiles/rules.js'
import { Profiles } from '../profiles/service.js'
import type { SessionView } from '../state.js'
import { SQLITE_VERSIONS, STEPS as DATABASE_STEPS } from '../storage/database.js'
import { SCHEMA_VERSION } from '../storage/schema.js'
import { TALLY_SCHEMA_VERSION } from '../stats/tally-schema.js'
import { ADAPTERS, trackerKeyRules } from '../tracker/adapters.js'
import { runLabelText } from '../tracker/model.js'
import { stateUrlOf, Updater } from '../updates/updater.js'
import { installed, UpdateWatcher } from '../updates/watcher.js'
import { firstRun } from '../setup.js'
import type { ServiceContext } from '../service.js'

type AccountsContext = Pick<ServiceContext,
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
  | 'dispatcher'
  | 'emailAt'
  | 'envFile'
  | 'getState'
  | 'hasAccount'
  | 'homeOf'
  | 'homes'
  | 'hub'
  | 'importedProfiles'
  | 'keyOrganizations'
  | 'knownTask'
  | 'ledger'
  | 'limitRetries'
  | 'limits'
  | 'limitsFile'
  | 'listen'
  | 'liveView'
  | 'lockedReaders'
  | 'logStartupDialogs'
  | 'mailRelay'
  | 'mcpPort'
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
  | 'readers'
  | 'release'
  | 'remotes'
  | 'requireModel'
  | 'runtimes'
  | 'saveAccounts'
  | 'sayBlankedSecrets'
  | 'secretsSaid'
  | 'sessions'
  | 'settingsFor'
  | 'spendsByKey'
  | 'startedAt'
  | 'stateDir'
  | 'tallyMode'
  | 'trackers'
  | 'vscode'
  | 'wedgedSessions'
  | 'writes'
>

export function wirePackages(ctx: AccountsContext): Packages {
  return new Packages({
    file: join(ctx.stateDir, 'packages.json'),
    cache: join(ctx.stateDir, 'packages'),
    envFile: join(dataHome, '.env'),
    get repos() {
      return ctx.configStore.current.projects
    },
    globalDir: ctx.homes.global.dir,
    ownDir: root,
    skillsDir: join(ctx.stateDir, 'skills'),
    skillRoots: () => [
      { dir: join(ctx.homes.global.dir, 'skills'), from: CLAUDE },
      { dir: join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills'), from: CODEX },
      { dir: join(homedir(), '.agents', 'skills'), from: CODEX },
    ],
    claudeConfigs: ctx.claudeConfigs,
    rules: trackerKeyRules(),
    tracker: (project) => {
      const server = ADAPTERS[ctx.configStore.current.trackers[project]!]!.mcpServer
      return server === undefined ? undefined : { server, required: !ctx.briefOn(project) }
    },
    agentOf: (project) => ctx.homes.find(ctx.choiceFor(project).account)?.agent ?? CLAUDE,
    updateMarketplace: (marketplace) => ctx.agentOf(ctx.homes.global).updateMarketplace!(ctx.homes.global, marketplace, ctx.PLUGIN_UPDATE_TIMEOUT_MS),
    addMarketplace: (dir) => ctx.agentOf(ctx.homes.global).addMarketplace!(ctx.homes.global, dir, ctx.PLUGIN_UPDATE_TIMEOUT_MS),
    baseEnv: (): NodeJS.ProcessEnv => sessionBase(process.env, ctx.packages.keyNames()),
    poolOf: (project) => keyPool(ctx.profiles.current(), ctx.profileKindsOf, process.env, project, ctx.configStore.current.trackers[project]!, ctx.configStore.current.feeds[project]),
    oauth: (project, server, url) => ctx.profiles.gateway(serverProfile(ctx.profiles.current(), project, ctx.configStore.current.trackers[project]!, ctx.configStore.current.feeds[project] ?? [], server)?.id, server, url),
    port: ctx.mcpPort,
    log: (line) => console.log(line),
    onChange: () => {
      ctx.dispatcher.check()
      ctx.hub.broadcast('state', ctx.getState())
    },
  })
}

export function briefOn(ctx: AccountsContext, project: string, reader = project): boolean {
  const own = ctx.configStore.current.briefs[project]
  if (own === true || (own === false && reader === project)) return own
  const tracker = ctx.readers().trackers[reader]!
  const server = ADAPTERS[tracker]!.mcpServer
  if (server === undefined || !ctx.packages.bringsServer(project, server)) return true
  if (reader === project) return false
  const { trackers, feeds } = ctx.configStore.current
  const set = ctx.profiles.current()
  return serverProfile(set, project, trackers[project]!, feeds[project] ?? [], tracker)?.id !== profileFor(set, reader, tracker)?.id
}

export function wireRuntimes(ctx: AccountsContext): Map<string, Agent> {
  return new Map<string, Agent>(
    Object.entries(AGENTS).map(([name, adapter]) => [
      name,
      adapter.setup({
        env: () => sessionBase(process.env, ctx.packages.keyNames()),
        timeoutMs: ctx.AGENT_TIMEOUT_MS,
        workDir: ctx.stateDir,
        checkedCli: () => ctx.configStore.current.cli[name] !== 'system',
        log: (line) => console.log(line),
        onCliChange: () => { void ctx.cliVersions.check(); ctx.dispatcher.check(); ctx.hub.broadcast('state', ctx.getState()) },
        onCliFailure: () => { ctx.configStore.saveCli(name, 'system') },
        onCliProgress: () => ctx.hub.broadcast('state', ctx.getState()),
        transport: (home): string | null => transportOf(home.agent, ctx.configStore.current.execution[CLAUDE], ctx.account.apiKey(home.key)),
        unattended: () => ctx.configStore.current.unattended,
        language: () => ctx.configStore.current.language ?? ctx.promptLanguage(),
        onLimits: (key, reported) => ctx.limits.report(key, reported),
      }),
    ]),
  )
}

export function wireModels(ctx: AccountsContext): ModelCatalog {
  return new ModelCatalog({
    list: async (home) => (await ctx.agentOf(home).models?.(home)) ?? null,
    title: (home) => AGENTS[home.agent]!.title,
    name: (home) => ctx.account.view.accounts.find((entry) => entry.key === home.key)?.name ?? home.key,
    now: () => Date.now(),
    log: (line) => console.warn(line),
  })
}

export function wireRequireModel(ctx: AccountsContext): (home: AccountHome, start: SessionStart) => Promise<void> {
  return async (home: AccountHome, start: SessionStart) => {
    const refusal = await ctx.models.refusal(home, start.name, start.model)
    if (refusal !== undefined) throw new NoticeError(refusal)
  }
}

export function wireSayBlankedSecrets(ctx: AccountsContext): (home: AccountHome) => void {
  return (home: AccountHome) => {
    const names = settingsSecrets(readJson(join(home.dir, 'settings.json')), sessionSecrets(ctx.packages.keyNames())).join(', ')
    if (ctx.secretsSaid.get(home.key) === names) return
    ctx.secretsSaid.set(home.key, names)
    if (names !== '') console.log(`launch: the env of account ${home.key}'s settings.json sets ${names}; chain sessions get them blank`)
  }
}

export function wireLaunchIn(ctx: AccountsContext): (home: AccountHome, start: SessionStart, project: string | undefined) => Promise<string> {
  return async (home: AccountHome, start: SessionStart, project: string | undefined) => {
    const blocked = ctx.cliCopies.blocked(home.agent)
    if (blocked) throw new NoticeError(blocked)
    if (project !== undefined) await ctx.protectionAudit.check(project)
    await ctx.requireModel(home, start)
    if (home.agent === CLAUDE && start.settings !== undefined) ctx.sayBlankedSecrets(home)
    try {
      return await ctx.cliLease.session(home, () => ctx.agentOf(home).launch(home, start))
    } catch (error) {
      const folder = project === undefined ? undefined : ctx.configStore.current.projects[project]
      const place = folder === undefined ? null : { task: start.name, folder, platform: process.platform, user: userInfo().username }
      throw (place === null ? null : untrustedStart(error, place)) ?? error
    }
  }
}

export function wireResumeIn(ctx: AccountsContext): (home: AccountHome, session: SessionHandle, start: SessionStart) => Promise<string> {
  return async (home: AccountHome, session: SessionHandle, start: SessionStart) => {
    const blocked = ctx.cliCopies.blocked(home.agent)
    if (blocked) throw new NoticeError(blocked)
    await ctx.requireModel(home, start)
    return ctx.cliLease.session(home, () => ctx.agentOf(home).resume(home, session, start))
  }
}

export function wireLimits(ctx: AccountsContext): LimitsWatcher {
  return new LimitsWatcher({
    file: ctx.limitsFile,
    intervalMs: ctx.LIMITS_POLL_MS,
    homes: () => ctx.homes.list(),
    ownerOf: (configDir) => ctx.homes.ownerOf(configDir),
    usage: (home) => {
      const { usage } = ctx.agentOf(home)
      return usage === undefined ? undefined : (at) => usage(home, at)
    },
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
    onChange: () => {
      ctx.hub.broadcast('state', ctx.getState())
      ctx.dispatcher.check()
    },
    onError: (error) => console.error(`limits:${error instanceof Error ? error.message : String(error)}`),
  })
}

export function wireUpdates(ctx: AccountsContext): UpdateWatcher {
  return new UpdateWatcher({
    repo: ctx.release.repo,
    current: ctx.release.version,
    enabled: () => ctx.configStore.current.updates.check && !firstRun(ctx.tallyMode(), Object.keys(ctx.configStore.current.projects).length),
    intervalMs: ctx.UPDATE_POLL_MS,
    onChange: () => ctx.hub.broadcast('state', ctx.getState()),
    log: (line) => console.log(line),
  })
}

export function wireUpdater(ctx: AccountsContext): Updater {
  return new Updater({
    root,
    home: dataHome,
    source,
    packageName: ctx.release.name,
    current: ctx.release.version,
    storage: { schema: SCHEMA_VERSION, database: SQLITE_VERSIONS + DATABASE_STEPS.length, tally: TALLY_SCHEMA_VERSION },
    startedAt: ctx.startedAt,
    active: () => ctx.dispatcher.state.active,
    stateUrl: () => stateUrlOf(ctx.listen.host, ctx.listen.port),
    onChange: () => ctx.hub.broadcast('state', ctx.getState()),
    log: (line) => console.log(line),
  })
}

export function wireCliVersions(ctx: AccountsContext): VersionWatcher {
  return new VersionWatcher({
    agents: () =>
      [...ctx.runtimes].flatMap(([name, agent]) => {
        const version = agent.version?.bind(agent)
        if (version === undefined) return []
        return [{ name, title: AGENTS[name]!.title, checked: AGENTS[name]!.checked, installed: () => agent.installed?.() !== false, version, prune: () => agent.cli?.prune() ?? Promise.resolve(), pending: () => agent.cli?.view().status === 'downloading' }]
      }),
    intervalMs: ctx.CLI_VERSION_POLL_MS,
    onChange: () => ctx.hub.broadcast('state', ctx.getState()),
    log: (line) => console.log(line),
  })
}

export function wireDaemons(ctx: AccountsContext): DaemonRefresh {
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
    onChange: () => ctx.hub.broadcast('state', ctx.getState()),
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
    onChange: () => ctx.hub.broadcast('state', ctx.getState()),
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
    timeoutMs: ctx.TRACKER_CHECK_MS,
    log: (line) => console.log(line),
    onChange: (set) => {
      ctx.trackers.apply(ctx.readers(), set)
      ctx.ciWatches.tokensChanged()
      void ctx.ciWatches.refresh()
      ctx.dispatcher.check()
      ctx.hub.broadcast('state', ctx.getState())
    },
    onCheck: () => {
      ctx.dispatcher.check()
      ctx.hub.broadcast('state', ctx.getState())
    },
  })
}

export function wireVscode(ctx: AccountsContext): VsCodeAccount {
  return new VsCodeAccount({
    file: vscodeSettingsFile(process.env),
    homes: () => ctx.homes.list(),
    ownerOf: (dir) => ctx.homes.ownerOf(dir),
    records: async (home) => (await ctx.agentOf(home).liveRecords?.(home)) ?? [],
    title: (home, sessionId) => ctx.chatTitles.of(join(home.dir, 'projects'), sessionId),
    intervalMs: APP_POLL_MS,
    onChange: () => ctx.hub.broadcast('state', ctx.getState()),
    onError: (error) => console.error(`vscode: ${error instanceof Error ? error.message : String(error)}`),
  })
}

export function wireAccount(ctx: AccountsContext): AccountWatcher {
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
      ctx.hub.broadcast('state', ctx.getState())
      ctx.dispatcher.check()
    },
    forget: (key) => ctx.saveAccounts(forgetAccount(ctx.ledger, key)),
    nameOf: (key) => ctx.ledger.accounts[key]?.name ?? null,
    name: (key, name) => ctx.saveAccounts(nameAccount(ctx.ledger, key, name)),
    transportOf: (home, apiKey) => transportOf(home.agent, ctx.configStore.current.execution[CLAUDE], apiKey),
    loginBlock: (): LoginBlock | null => loginBlock(ctx.dispatcher.state.active, ctx.agents, ctx.activeAccount()),
    sessionsIn: (key) => liveSessions(ctx.agents, key),
    workingIn: (key) => ctx.agents.some((agent) => (agent.account ?? 'global') === key && !agent.resting && isLive(agent) && lampOf(agent, null) === 'working'),
    projectsOn: (key) => projectsByAccount(ctx.configStore.current, Object.keys(ctx.configStore.current.projects))[key] ?? [],
    pool: () => poolEntries(ctx.configStore.current, Object.keys(ctx.configStore.current.projects)),
    makeShared: (agent, key) => {
      ctx.configStore.saveSharedAccount(agent, key)
      console.log(`accounts: ${key} is the shared ${agent} account, the shared one named no folder`)
      ctx.dispatcher.check()
    },
    missing: () => [...ctx.runtimes].flatMap(([name, agent]) => (agent.installed?.() === false ? [name] : [])),
    online: ctx.online,
    sessionsKnown: () => ctx.agentsRead,
    removing: (key) => ctx.ledger.removing.includes(key),
    markRemoving: (key, on) => ctx.saveAccounts(markRemoving(ctx.ledger, key, on)),
    configPending: (key) => ctx.daemons.pending(key),
    limits: (key) => ctx.limits.limits(key),
    usage: (key) => ctx.limits.usage(key),
    lastLimit: (key) => ctx.limitRetries.lastAt(key),
    checkKey: (agent, key) => KEY_CHECKS[keyProvider(agent, key)](key, KEY_CHECK_TIMEOUT_MS),
    keyCheckMs: KEY_CHECK_MS,
    organizations: {
      of: (key) => ctx.keyOrganizations.get(key),
      note: (key, organization) => {
        ctx.keyOrganizations.set(key, organization)
        ctx.writes.add(`the organization of ${key}`, saveKeyOrganization(ctx.db, key, organization, new Date()))
      },
      forget: (key) => {
        if (!ctx.keyOrganizations.delete(key)) return
        ctx.writes.add(`the organization of ${key}`, forgetKeyOrganization(ctx.db, key))
      },
    },
    checkCredit: (agent, key) => CREDIT_CHECKS[keyProvider(agent, key)](key, KEY_CHECK_TIMEOUT_MS),
    creditCheckMs: CREDIT_CHECK_MS,
    intervalMs: ctx.ACCOUNT_POLL_MS,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
    now: () => new Date(),
    onChange: () => {
      let changed = false
      for (const entry of ctx.account.view.accounts) {
        const noted = noteAccount(ctx.ledger, entry.key, entry.status?.loggedIn === true ? entry.status.email : null, new Date())
        if (noted === undefined) continue
        ctx.saveAccounts(noted)
        changed = true
      }
      if (changed || ctx.limits.deferred) ctx.limits.refresh()
      ctx.hub.broadcast('state', ctx.getState())
      ctx.dispatcher.check()
    },
    onError: (error) => console.error(`account: ${error instanceof Error ? error.message : String(error)}`),
  })
}

export function wireOwners(ctx: AccountsContext): TranscriptOwners {
  return new TranscriptOwners({
    homes: () => ctx.homes.list(),
    transcripts: (home) => ctx.agentOf(home).transcripts(home),
    rescanMs: ctx.OWNERS_RESCAN_MS,
    onChange: () => ctx.hub.broadcast('state', ctx.getState()),
    onError: (error) => console.error(`sessions: ${error instanceof Error ? error.message : String(error)}`),
  })
}

export function wireContextWindows(ctx: AccountsContext): ContextWindows {
  return new ContextWindows({
    probe: async (key, model, _task, settings) => {
      const home = ctx.homeOf(key)
      return (await ctx.agentOf(home).contextWindow?.(home, model, settings)) ?? null
    },
    stamp: async (key) => {
      const home = ctx.homeOf(key)
      return (await ctx.agentOf(home).windowStamp?.(home)) ?? ''
    },
    recheckMs: ctx.WINDOW_RECHECK_MS,
    onError: (error) => console.warn(`context window: ${error instanceof Error ? error.message : String(error)}`),
  })
}

export function wireMonitor(ctx: AccountsContext): SessionMonitor {
  return new SessionMonitor({
    agentOf: ctx.agentOf,
    homes: () => ctx.homes.list(),
    emailOf: (key) => ctx.account.emailOf(key),
    apiKey: (key) => ctx.account.apiKey(key),
    keyLimits: (key) => ctx.account.apiKey(key) && !ctx.spendsByKey(key),
    // The stems name the fix and carry sessions (`<KEY>-FIX`, `<KEY>-CARRY`), the prefixes the tasks of projects whose ids are the tracker's own.
    projectKeys: () => {
      const config = ctx.configStore.current
      const projects = Object.keys(config.projects)
      return [...new Set([...projects.map((project) => fixStem(config.keys, project)), ...projects.map((project) => idPrefixOf(config, project))])]
    },
    contextWindow: (key, model, task, settings) => (ctx.agentOf(ctx.homeOf(key)).contextWindow === undefined ? null : ctx.contextWindows.peek(key, model, task, settings)),
    approval: (sessionId) => ctx.approvals.ask(sessionId),
    intervalMs: ctx.SESSION_POLL_MS,
    onAgents: (list) => {
      const before = JSON.stringify(ctx.account.view.loginBlock)
      ctx.agents = list
      ctx.agentsRead = true
      ctx.approvals.settle(new Set(list.filter((agent) => agent.status === 'waiting').map((agent) => agent.sessionId)))
      if (JSON.stringify(ctx.account.view.loginBlock) !== before) ctx.hub.broadcast('state', ctx.getState())
    },
    onChange: (views) => {
      ctx.sessions = views
      ctx.logStartupDialogs(views)
      ctx.hub.broadcast('state', ctx.getState())
      ctx.dispatcher.check()
      settleMail(ctx.mailRelay)
    },
    onError: (error) => console.error(`sessions: ${error instanceof Error ? error.message : String(error)}`),
  })
}

export function logStartupDialogs(ctx: AccountsContext, views: SessionView[]): void {
  for (const view of views) {
    if (view.startupDialog === null || ctx.wedgedSessions.has(view.sessionId)) continue
    ctx.wedgedSessions.add(view.sessionId)
    console.warn(`sessions: ${view.task} hangs on a Claude Code dialog before its first turn: ${view.startupDialog} (session ${view.sessionId}, ${view.cwd})`)
  }
  for (const view of views) {
    const key = `${view.sessionId}@${view.hungSince}`
    if (view.hungSince === null || ctx.wedgedSessions.has(key)) continue
    ctx.wedgedSessions.add(key)
    console.warn(`sessions: the turn of ${view.task} has written nothing since ${view.hungSince} and is taken for hung (session ${view.sessionId})`)
  }
}

export function wireAgentOf(ctx: AccountsContext): (home: AccountHome) => Agent {
  return (home: AccountHome): Agent => ctx.runtimes.get(home.agent)!
}

export function wireEnvOf(ctx: AccountsContext): (home: AccountHome) => NodeJS.ProcessEnv {
  return (home: AccountHome) => ctx.agentOf(home).env(home)
}

export function wireStopIn(ctx: AccountsContext): (home: AccountHome, session: SessionHandle) => Promise<void> {
  return (home: AccountHome, session: SessionHandle) => ctx.agentOf(home).stop(home, session)
}

export function wireEmailAt(ctx: AccountsContext): (key: string, at: string | null) => string | null {
  return (key: string, at: string | null): string | null =>
    (at === null ? null : accountAt(ctx.ledger, key, at)) ?? ctx.account.emailOf(key)
}

export function wireSessionAccount(ctx: AccountsContext): (sessionId: string | null, at: string | null) => string | null {
  return (sessionId: string | null, at: string | null): string | null => {
    if (sessionId === null) return null
    const live = ctx.sessions.find((view) => view.sessionId === sessionId)
    if (live !== undefined) return live.account
    const key = ctx.owners.of(sessionId)
    return key === undefined ? null : ctx.emailAt(key, at)
  }
}

export function wireAccountNow(ctx: AccountsContext): (key?: string) => { id: string | null; ready: boolean; label: string; provider: string | undefined; } {
  return (key = ctx.account.view.active) => currentAccount(ctx.account.view, key)
}

export function wireLiveView(ctx: AccountsContext): (task: string) => SessionView | undefined {
  return (task: string) => ctx.sessions.find((each) => each.task === task && each.lamp !== 'finished')
}

export function wireSteering(ctx: AccountsContext): (sessionId: string) => boolean {
  return (sessionId: string) => ctx.agents.some((each) => each.sessionId === sessionId && each.steers === true)
}

export function wireAgentStatus(ctx: AccountsContext): (task: string) => import("../sessions/agents.js").AgentStatus | undefined {
  return (task: string) => {
    const view = ctx.liveView(task)
    if (view === undefined) return undefined
    if (ctx.monitor.holds.turning(view.sessionId, view.ask?.id ?? null)) return 'busy'
    const agent = ctx.agents.find((each) => each.sessionId === view.sessionId)
    return turnStatus(agent?.status, view.lastActivityAt, new Date(), view.lamp === 'limit', agent?.state === 'blocked')
  }
}

export function wireHasAccount(ctx: AccountsContext): (provider: string, key: string) => boolean {
  return (provider: string, key: string) => ctx.homes.find(key)?.agent === provider
}

export function wireChoiceFor(ctx: AccountsContext): (project: string | undefined, task?: string) => RunChoice {
  return (project: string | undefined, task?: string): RunChoice =>
    runChoice(task === undefined ? undefined : ctx.knownTask(task), runSettings(ctx.configStore.current, project), ctx.hasAccount)
}

export function wirePlanFor(ctx: AccountsContext): (task: string, prompt: string, project?: string | undefined) => LaunchPlan {
  return (task: string, prompt: string, project = ctx.projectOf(task)): LaunchPlan => {
    const full = withUnattended(prompt, ctx.dispatcher.state.unattended, ctx.promptLanguage(project))
    const plan = launchPlan(ctx.knownTask(task), full, runSettings(ctx.configStore.current, project), ctx.configStore.current.modelPrompts, ctx.hasAccount)
    if (plan.warning !== null) console.warn(plan.warning)
    return plan
  }
}

export function wireAgentExtras(ctx: AccountsContext): (home: AccountHome, project: string | undefined, task: string) => Pick<SessionStart, "bypassSandbox" | "mcp" | "plugins" | "protection" | "mainBranch"> {
  return (home: AccountHome, project: string | undefined, task: string): Pick<SessionStart, 'bypassSandbox' | 'mcp' | 'plugins' | 'protection' | 'mainBranch'> => ({
    protection: (project === undefined ? undefined : ctx.configStore.current.settings[project]?.protection) ?? ctx.configStore.current.protection,
    ...(project === undefined ? {} : { mainBranch: ctx.branchOf(project) }),
    ...(home.agent !== CLAUDE && ctx.configStore.current.execution[home.agent] === 'bypass' ? { bypassSandbox: true } : {}),
    ...(project === undefined ? {} : ctx.packages.startOf(project, task, home.agent)),
  })
}

export function wireNoAccountFor(ctx: AccountsContext): (task: string, fallback: string, provider: string) => Notice {
  return (task: string, fallback: string, provider: string) =>
    notice('chain.noAccountFor', {
      task,
      label: runLabelText({ provider: fallback, model: null }),
      provider: runLabelText({ provider, model: null }),
    })
}

export function wireReach(ctx: AccountsContext): Reachability {
  return new Reachability({
    probe: (url) => answers(url, ctx.NETWORK_PROBE_MS),
    ttlMs: ctx.OFFLINE_RETRY_MS,
    now: () => Date.now(),
    onChange: (url, up) => console.log(up ? `network: ${url} answers again` : `network: ${url} does not answer; account checks and /usage wait for it`),
  })
}

export function wireProfileBlock(ctx: AccountsContext): (project: string) => Notice | undefined {
  return (project: string): Notice | undefined => {
    const refused = ctx.profiles.refused(project)
    return refused === undefined ? undefined : notice('profiles.paused', { profile: refused.name, project: projectLabel(ctx.configStore.current, project) })
  }
}

export function wirePullBlock(ctx: AccountsContext): (project: string) => Notice | undefined {
  return (project: string): Notice | undefined => {
    const urls = ctx.remotes.urls[project]
    if (!ctx.pullRequestsOn(project) || urls === undefined) return undefined
    const ready = ctx.pullReadinessOf(project, urls)
    return 'notice' in ready ? notice('review.notReady', { project }, { cause: ready.notice }) : undefined
  }
}
