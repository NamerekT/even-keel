import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { answers } from '../account/network.js'
import { headerLevels } from '../account/header-levels.js'
import { AGENTS } from '../agent/adapters.js'
import { outdatedDaemonView } from '../agent/versions.js'
import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import { fallbacksSince, fixEpisodes, handoffsOf, launchDays, taskSessions } from '../chain/launches.js'
import { mergeCheck } from '../chain/mainci.js'
import { pullReadiness } from '../review/open.js'
import { archivedShown } from '../chain/archive.js'
import { ConfigStore } from '../config-store.js'
import { idPrefixOf, listenOf, projectLabel, projectLabels, projectsByAccount, runSettings } from '../config.js'
import { runGit } from '../git/run.js'
import { englishOf, fail, notice, NoticeError, noticeOf } from '../notice/notice.js'
import { guardHosts, guardToken } from '../guard.js'
import { readJson } from '../packages/plugins.js'
import { checkDraft, isTrusted } from '../projects/check.js'
import { addProject } from '../projects/add.js'
import { removalBlock } from '../projects/removal.js'
import { remotesIn, sameRepository } from '../projects/remotes.js'
import { createEvenKeelServer } from '../server.js'
import { inboxImage } from '../sessions/inbox.js'
import { sharedFile } from '../sessions/shareFile.js'
import { deliveredMail, type SessionMail } from '../sessions/mail.js'
import { mailFor } from '../sessions/mailRelay.js'
import { noteAtEnd } from '../sessions/note.js'
import { root, source } from '../locations.js'
import { profileFor } from '../profiles/model.js'
import { profilesControl } from '../profiles/control.js'
import type { EvenKeelState } from '../state.js'
import { withinWindow } from '../stats/checkpoint.js'
import { taskCheckpoint } from '../stats/task-checkpoint.js'
import { setStateValue } from '../storage/service-state.js'
import { checkServer, serverValues } from '../stats/connect.js'
import { readToolsView } from '../tools/panel.js'
import { ADAPTERS } from '../tracker/adapters.js'
import { taskControl } from '../tracker/control.js'
import { RAN_SHOWN_MS } from '../tracker/start.js'
import type { ServiceContext } from '../service.js'

type HostingContext = Pick<ServiceContext,
  | 'CONFIG_POLL_MS'
  | 'FALLBACK_TOAST_MS'
  | 'LAUNCH_CHART_DAYS'
  | 'TRACKER_CHECK_MS'
  | 'account'
  | 'activeAccount'
  | 'agentOf'
  | 'answerSession'
  | 'applyTally'
  | 'approvals'
  | 'archive'
  | 'branchOf'
  | 'chainControl'
  | 'changelogs'
  | 'checkMergeTarget'
  | 'ciWatches'
  | 'claudeAccount'
  | 'claudeConfigs'
  | 'cliCopies'
  | 'cliChecks'
  | 'cliVersions'
  | 'configStore'
  | 'configuredProject'
  | 'daemons'
  | 'db'
  | 'dismissedUpdate'
  | 'dispatcher'
  | 'emailAt'
  | 'forwards'
  | 'getState'
  | 'homes'
  | 'owners'
  | 'agents'
  | 'hasAccount'
  | 'hub'
  | 'inHomes'
  | 'launches'
  | 'limits'
  | 'linkFor'
  | 'listen'
  | 'listenError'
  | 'lockedReaders'
  | 'mailRelay'
  | 'mailbox'
  | 'models'
  | 'monitor'
  | 'noAccountFor'
  | 'packages'
  | 'pinnedCheckpoint'
  | 'profiles'
  | 'projectsChanged'
  | 'promptLanguage'
  | 'protectionAudit'
  | 'pullReadinessOf'
  | 'readerFor'
  | 'readerTasks'
  | 'readers'
  | 'refreshProject'
  | 'refreshers'
  | 'releasesView'
  | 'remotes'
  | 'removalFacts'
  | 'rulesOf'
  | 'sameRepositoryOf'
  | 'secrets'
  | 'server'
  | 'sessionAccount'
  | 'sessions'
  | 'startedAt'
  | 'stats'
  | 'steering'
  | 'tally'
  | 'tallyMode'
  | 'tasksByProject'
  | 'token'
  | 'trackers'
  | 'transcriptWatch'
  | 'updater'
  | 'updates'
  | 'vocabularies'
  | 'works'
  | 'writes'
>

export function wireGetState(ctx: HostingContext): () => EvenKeelState {
  const view = (orders: ReturnType<HostingContext['dispatcher']['orders']>): EvenKeelState => ({
    protection: ctx.protectionAudit.view,
    startedAt: ctx.startedAt,
    projects: Object.keys(ctx.configStore.current.projects),
    projectKeys: ctx.configStore.current.keys,
    projectLabels: projectLabels(ctx.configStore.current),
    taskPrefixes: Object.fromEntries(Object.keys(ctx.configStore.current.keys).map((project) => [project, idPrefixOf(ctx.configStore.current, project)])),
    config: ctx.configStore.view(ctx.lockedReaders()),
    chain: {
      active: ctx.dispatcher.state.active,
      parallel: ctx.configStore.current.parallel,
      queue: ctx.dispatcher.state.queue,
      projects: orders,
      skipped: ctx.dispatcher.state.skipped,
      leftovers: ctx.dispatcher.state.leftovers,
    },
    tasks: Object.keys(ctx.configStore.current.projects).flatMap((project) => {
      const listed = ctx.tasksByProject.get(project) ?? []
      const archived = archivedShown(ctx.archive, project, listed, new Date(Date.now() - RAN_SHOWN_MS))
      return [...listed, ...archived].map((task) => ({ ...task, project }))
    }),
    // A finished session's feed is read from its record; the one the chain waits on keeps it: delivering an answer stops it for a while.
    sessions: ctx.sessions.map((view) =>
      view.lamp === 'finished' && !ctx.dispatcher.state.active.some((chain) => chain.current?.sessionId === view.sessionId) ? { ...view, feed: [] } : view,
    ),
    limits: ctx.limits.limits(ctx.activeAccount()),
    usage: ctx.limits.usage(ctx.activeAccount()),
    account: {
      ...ctx.account.view,
      headerLevels: Object.fromEntries(Object.keys(ctx.configStore.current.projects).map((project) => [project, headerLevels({
        shared: runSettings(ctx.configStore.current, undefined),
        project: runSettings(ctx.configStore.current, project),
        tasks: ctx.tasksByProject.get(project) ?? [],
        order: orders[project]?.order ?? [],
        current: ctx.dispatcher.state.active.find((chain) => chain.project === project)?.current ?? null,
        holding: [...(ctx.dispatcher.state.skipped[project] ?? []), ...(orders[project]?.waiting ?? [])],
        sessionAccount: (sessionId) => ctx.agents.find((entry) => entry.sessionId === sessionId)?.account ?? ctx.owners.of(sessionId),
        hasAccount: ctx.hasAccount,
      })])),
    },
    trackers: ctx.trackers.views(),
    trackerUrls: {
      default: ctx.trackers.setupOf(null)?.issueUrl(null) ?? null,
      projects: Object.fromEntries(Object.keys(ctx.readers().projects).map((reader) => [idPrefixOf(ctx.readers(), reader), ctx.trackers.setupOf(reader)?.issueUrl(reader) ?? null])),
      pages: Object.fromEntries(Object.keys(ctx.readers().projects).map((reader) => [reader, ctx.trackers.setupOf(reader)?.projectUrl?.(reader) ?? null])),
    },
    ci: Object.fromEntries([...ctx.ciWatches.byProject.keys()].map((project) => [project, ctx.ciWatches.shown(project).map((watch) => watch.view)])),
    remotes: ctx.remotes.view,
    sameRepository: Object.fromEntries(
      Object.keys(ctx.remotes.repositories).map((project) => [project, Object.keys(ctx.remotes.repositories).filter((other) => other !== project && ctx.sameRepositoryOf(project, other))]),
    ),
    pullReadiness: Object.fromEntries(
      Object.entries(ctx.remotes.urls)
        .filter(([project]) => ctx.configStore.current.projects[project] !== undefined)
        .map(([project, urls]) => {
          const ready = ctx.pullReadinessOf(project, urls)
          return [project, 'notice' in ready ? ready.notice : null]
        }),
    ),
    launches: launchDays(ctx.launches, new Date(), ctx.LAUNCH_CHART_DAYS, (project) => ctx.configStore.current.keys[project] !== undefined),
    taskSessions: taskSessions(ctx.launches, ctx.sessions, ctx.sessionAccount, (sessionId) => ctx.monitor.compactionsOf(sessionId)),
    fixes: fixEpisodes(ctx.launches).episodes,
    works: ctx.works.view(),
    context: ctx.configStore.current.context,
    configError: ctx.configStore.error ?? ctx.listenError,
    packages: ctx.packages.view(),
    secrets: ctx.secrets.view(),
    profiles: ctx.profiles.view(),
    language: ctx.configStore.current.language,
    unattended: ctx.dispatcher.state.unattended,
    trimTools: ctx.dispatcher.state.trimTools,
    tally: ctx.tallyMode(),
    tallyHealth: ctx.tally.health(),
    updates: { ...ctx.releasesView(), ...ctx.updater.view() },
    cliVersions: [...ctx.cliVersions.view(), ...ctx.daemons.outdated().map((daemon) => outdatedDaemonView(daemon, AGENTS[daemon.agent]!.title))],
    cliCopies: Object.fromEntries(Object.entries(ctx.cliCopies.view()).map(([name, copy]) => [name, { ...copy, installed: ctx.cliVersions.installedOf(name) }])),
    cliChecks: ctx.cliChecks.view(),
    fallbacks: fallbacksSince(ctx.launches, new Date(Date.now() - ctx.FALLBACK_TOAST_MS)).map(({ at, task, project, fallback }) => ({
      at,
      task,
      notice: ctx.noAccountFor(task, fallback, runSettings(ctx.configStore.current, project).provider),
    })),
    mailbox: Object.fromEntries(
      ctx.sessions.flatMap((view): [string, SessionMail][] => {
        const mail = ctx.mailbox.of(view.sessionId)
        const steers = ctx.steering(view.sessionId)
        const listens = steers || ctx.mailbox.listens(view.sessionId)
        return listens || mail.length > 0 ? [[view.sessionId, { listens, steers, mail }]] : []
      }),
    ),
    changelogs: ctx.changelogs.writtenTasks(),
    forwards: ctx.forwards.view(),
  })
  return () => view(ctx.dispatcher.orders())
}

export function wireServer(ctx: HostingContext): import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse> {
  const mailOf = (sessionId: string) => deliveredMail(ctx.mailbox.delivered(sessionId), ctx.configStore.current.language ?? ctx.promptLanguage())
  return createEvenKeelServer({
    cli: ctx.cliCopies,
    hub: ctx.hub,
    publicDir: join(root, 'dist', 'web'),
    getState: ctx.getState,
    control: ctx.chainControl,
    account: ctx.account,
    sessions: {
      answer: ({ project, task, sessionId, ask, answers, text, files }) => ctx.answerSession(project, task, sessionId, ask, { from: 'page', answers, text, files }),
      dismissMail: (sessionId) => {
        ctx.mailbox.dismiss(sessionId)
        ctx.hub.broadcast('state', ctx.getState())
      },
    },
    settings: {
      save: async (project, form, base) => {
        if (ctx.configStore.current.projects[project] === undefined) throw fail('config.unknownProject', { key: project })
        const moved = form.tracker !== base.tracker || form.trackerProject !== base.trackerProject
        if (moved && ctx.lockedReaders().includes(project)) throw fail('config.trackerLocked', { key: projectLabel(ctx.configStore.current, project) })
        if (form.pullRequests && !base.pullRequests) {
          const ready = ctx.pullReadinessOf(project, await remotesIn(runGit, form.repo))
          if ('notice' in ready) throw fail('review.cannotEnable', { project }, { cause: ready.notice })
        }
        if (form.mergeInto !== base.mergeInto || form.repo !== base.repo) await ctx.checkMergeTarget(project, form)
        ctx.configStore.saveProject(project, form, base, profileFor(ctx.profiles.current(), project, ctx.configStore.current.trackers[project]!)?.rules)
        console.log(`page: the settings of ${project} are written to the config`)
      },
      saveShared: (form, base) => {
        ctx.configStore.saveShared(form, base)
        console.log('page: the shared settings are written to the config')
      },
      check: (draft) =>
        checkDraft(
          {
            git: runGit,
            raw: () => ctx.configStore.raw(),
            adapters: ADAPTERS,
            env: ctx.profiles.valuesFor(draft.profile, draft.tracker),
            // A new project has no accounts of its own: its chain runs on the shared Claude account.
            claudeConfigs: () => ctx.claudeConfigs().map(readJson),
            timeoutMs: ctx.TRACKER_CHECK_MS,
            user: userInfo().username,
          },
          draft,
        ),
      trust: (project, account) => {
        const folder = ctx.configStore.current.projects[project]
        if (folder === undefined) throw fail('config.unknownProject', { key: project })
        const configs = ctx.claudeConfigs(account ?? runSettings(ctx.configStore.current, project).accounts[CLAUDE] ?? ctx.claudeAccount()).map(readJson)
        return { folder, trusted: configs.some((config) => isTrusted(config, folder)), platform: process.platform, user: userInfo().username }
      },
      add: (draft) => addProject({ configStore: ctx.configStore, profiles: ctx.profiles, git: runGit }, draft),
      remove: (project) => {
        const repo = ctx.configStore.current.projects[project]
        if (repo === undefined) throw fail('config.unknownProject', { key: project })
        const blocked = removalBlock(ctx.removalFacts(project, repo))
        if (blocked !== null) throw new NoticeError(blocked)
        ctx.configStore.removeProject(project)
        console.log(`page: the project ${project} is removed from the config; its repository, worktrees and branches are left as they are`)
      },
      addFeed: (project, { profile, ...draft }) => {
        const chosen = profile === null ? undefined : ctx.profiles.current().profiles.find((each) => each.id === profile)
        if (profile !== null && chosen === undefined) throw fail('profiles.unknown', {})
        if (chosen !== undefined && chosen.kind !== draft.tracker) throw fail('profiles.otherTracker', { profile: chosen.name, project: draft.key.trim() })
        const id = ctx.configStore.addFeed(project, draft)
        if (chosen !== undefined) ctx.profiles.link(id, chosen.id, true)
        console.log(`page: the task feed ${draft.key.trim()} is added to ${projectLabel(ctx.configStore.current, project)}`)
      },
      removeFeed: (project, feed) => {
        const key = ctx.configStore.current.feeds[project]?.find((each) => each.id === feed)?.key
        ctx.configStore.removeFeed(project, feed)
        ctx.profiles.link(feed, null, true)
        console.log(`page: the task feed ${key} is removed from ${projectLabel(ctx.configStore.current, project)}`)
      },
      linkFeed: (project, feed, profile) => {
        const found = ctx.configStore.current.feeds[project]?.find((each) => each.id === feed)
        if (found === undefined) throw fail('config.unknownFeed', {})
        if (ctx.lockedReaders().includes(feed)) throw fail('config.feedLocked', { project: projectLabel(ctx.configStore.current, project), key: found.key })
        ctx.profiles.link(feed, profile, true)
      },
      dismissUpdate: (version) => {
        ctx.dismissedUpdate = version
        ctx.writes.add('the dismissed update', setStateValue(ctx.db, 'updates.dismissed', version))
        ctx.hub.broadcast('state', ctx.getState())
      },
      muteUpdates: () => ctx.configStore.saveUpdates({ notify: false }),
      installUpdate: () => ctx.updater.update(ctx.releasesView().available),
      revertUpdate: () => ctx.updater.revert(),
      closeUpdateResult: () => ctx.updater.seen(),
    },
    packages: ctx.packages,
    secrets: {
      set: (name, value) => {
        ctx.secrets.set(name, value)
        console.log(`page: ${name} is written`)
      },
      remove: (name) => {
        ctx.secrets.remove(name)
        console.log(`page: ${name} is removed`)
      },
      update: (values) => {
        ctx.secrets.update(values)
        console.log(`page: ${Object.keys(values).join(', ')} are written`)
      },
    },
    tally: {
      set: async (mode, draft) => {
        if (mode === 'server') {
          const values = serverValues(draft, process.env)
          await checkServer(values, process.env)
          const changed = Object.fromEntries(Object.entries(values).filter(([name, value]) => process.env[name] !== value))
          if (Object.keys(changed).length > 0) ctx.secrets.update(changed)
        }
        ctx.configStore.saveTally(mode)
        console.log(`page: stats are ${mode === 'off' ? 'off' : `on, ${mode}`}`)
        await ctx.applyTally()
      },
    },
    profiles: profilesControl(ctx.profiles, (project) => {
      if (!Object.hasOwn(ctx.configStore.current.projects, project)) throw fail('config.unknownProject', { key: project })
      if (ctx.lockedReaders().includes(project)) throw fail('config.trackerLocked', { key: projectLabel(ctx.configStore.current, project) })
    }),
    launches: () => ctx.launches,
    sessionRecord: async (sessionId) => {
      for (const home of ctx.homes.list()) {
        const found = await ctx.agentOf(home).record(home, sessionId)
        if (found !== undefined) return { ...found, account: ctx.sessionAccount(sessionId, found.startedAt) ?? ctx.emailAt(home.key, found.startedAt) }
      }
      return undefined
    },
    transcript: (sessionId, after) =>
      ctx.inHomes(async (home) => {
        const agent = ctx.agentOf(home)
        const feed = await agent.feed(home, sessionId, after, mailOf(sessionId))
        if (feed !== undefined && agent.feedFile !== undefined) void ctx.transcriptWatch.keep(sessionId, () => agent.feedFile!(home, sessionId))
        return feed
      }),
    transcriptImage: async (sessionId, tool, index) => {
      const image = await ctx.inHomes(async (home) => ctx.agentOf(home).image?.(home, sessionId, tool, index))
      if (image === undefined) return undefined
      const data = Buffer.from(image.data, 'base64')
      return { type: image.type, size: data.length, body: Readable.from([data]) }
    },
    inboxFile: async (sessionId, name) => {
      const feed = await ctx.inHomes((home) => ctx.agentOf(home).feed(home, sessionId, 0, mailOf(sessionId)))
      const found = inboxImage(feed?.lines.flatMap((line) => line.files ?? []) ?? [], name)
      if (found === undefined) return undefined
      const size = await stat(found.path).then((info) => info.size, () => null)
      return size === null ? undefined : { type: found.type, size, body: createReadStream(found.path) }
    },
    sharedFile: async (sessionId, tool, index) => {
      const feed = await ctx.inHomes((home) => ctx.agentOf(home).feed(home, sessionId, 0))
      const share = feed?.lines.find((line) => line.tool === tool && line.share !== undefined)?.share
      const found = share === undefined ? undefined : sharedFile(share, index)
      if (found === undefined) return undefined
      const size = await stat(found.path).then((info) => (info.isFile() ? info.size : null), () => null)
      return size === null ? undefined : { type: found.type, size, body: createReadStream(found.path) }
    },
    checkpoint: async (sessionId) => {
      const run = handoffsOf(ctx.launches, sessionId)
      if (run === undefined) return undefined
      const view = ctx.sessions.find((each) => each.sessionId === sessionId)
      const window = view?.contextWindow ?? ctx.configStore.current.context.window
      const task = ctx.tasksByProject.get(run.project)?.find((each) => each.id === run.task)
      const pinned = taskCheckpoint(ctx.pinnedCheckpoint(run.project), task?.labels)
      const { first, source } = await ctx.stats.checkpoint(ctx.configStore.current.keys[run.project] ?? run.project, pinned)
      const settings = ctx.configStore.current.settings[run.project]
      const shares = settings?.checkpointShares ?? ctx.configStore.current.stats.checkpointShares
      const threshold = withinWindow({ first, source }, window, shares, view?.agent ?? null)
      const off = !(settings?.contextHandoffs ?? ctx.configStore.current.contextHandoffs)
      return { ...run, ...threshold, ...(off ? { source: 'off' as const } : {}), context: ctx.monitor.contextOf(sessionId) ?? null }
    },
    handoffNote: async (sessionId) => {
      if (handoffsOf(ctx.launches, sessionId) === undefined) return undefined
      const feed = await ctx.inHomes((home) => ctx.agentOf(home).feed(home, sessionId, 0))
      return feed !== undefined && noteAtEnd(feed.lines)
    },
    mail: (sessionId, event) => (handoffsOf(ctx.launches, sessionId) === undefined ? undefined : mailFor(ctx.mailRelay, sessionId, event)),
    permission: (sessionId, tool, input, since) => (handoffsOf(ctx.launches, sessionId) === undefined ? undefined : ctx.approvals.poll(sessionId, tool, input, since)),
    mergeCheck: (sessionId) => {
      const run = handoffsOf(ctx.launches, sessionId)
      if (run === undefined) return undefined
      const settings = ctx.configStore.current.settings[run.project]
      const views = ctx.ciWatches.shown(run.project).map((watch) => watch.view)
      const commands = settings === undefined ? [] : mergeCheck(settings.check, settings.ci, views)
      return { commands, branch: ctx.branchOf(run.project), standards: settings?.standards ?? [] }
    },
    tools: async (project) => {
      const repo = ctx.configStore.current.projects[project]
      if (repo === undefined) return undefined
      const list = ctx.homes.list()
      const used = projectsByAccount(ctx.configStore.current, Object.keys(ctx.configStore.current.projects))
      const codexKey = runSettings(ctx.configStore.current, project).accounts[CODEX]
      const view = await readToolsView(project, {
        repo,
        branch: ctx.branchOf(project),
        git: runGit,
        globalDir: ctx.homes.global.dir,
        configs: ctx.claudeConfigs(),
        accounts: list.filter((home) => !home.global).map(({ key, dir, agent }) => ({ key, dir, agent, used: used[key] !== undefined })),
        homes: list.map((home) => home.dir),
        trim: ctx.dispatcher.state.trimTools,
        hidden: ctx.configStore.current.hiddenSkills,
        mode: ctx.agentOf(ctx.homes.find(ctx.claudeAccount()) ?? ctx.homes.global).mode,
        reach: ctx.packages.reach(project),
        codexHome: list.find((home) => home.agent === CODEX && home.key === codexKey)?.dir,
      })
      const received = view.received
      return received === null ? view : { ...view, received: { ...received, account: ctx.sessionAccount(received.sessionId, received.at) } }
    },
    vocabulary: (id) => (Object.hasOwn(ctx.readers().projects, id) ? ctx.vocabularies.get(id) : Promise.resolve(undefined)),
    models: async (key) => {
      const home = ctx.homes.find(key)
      return home === undefined ? null : ctx.models.of(home)
    },
    tasks: taskControl({
      configuredProject: ctx.configuredProject, linkFor: ctx.linkFor, rulesOf: ctx.rulesOf, readerFor: ctx.readerFor, refreshers: ctx.refreshers, readerTasks: ctx.readerTasks, refreshProject: ctx.refreshProject,
      pollReviews: (project) => ctx.dispatcher.pollReviews(project),
      broadcast: () => ctx.hub.broadcast('state', ctx.getState()),
    }),
    changelog: async (project, milestone, op) => {
      if (!Object.hasOwn(ctx.configStore.current.projects, project)) throw fail('chain.unknownProject', { project })
      const view = await ctx.changelogs.run(project, milestone, op)
      if (op.op === 'write') ctx.hub.broadcast('state', ctx.getState())
      return view
    },
    carry: (project) => ctx.forwards.carry(project),
    resolveCarry: (project) => ctx.forwards.resolve(project),
    stats: ctx.stats,
    guard: () => ({ hosts: guardHosts(ctx.listen.host, ctx.configStore.current.allowedHosts), token: ctx.token, language: ctx.configStore.current.language ?? ctx.promptLanguage() }),
  })
}

export function applyGuard(ctx: HostingContext): void {
  let next: string | null
  try {
    next = guardToken(process.env, listenOf(process.env).host)
  } catch (error) {
    console.error(`guard: ${englishOf(noticeOf(error))}; the previous token stays`)
    return
  }
  if (next === ctx.token) return
  ctx.token = next
  console.log(next === null ? 'guard: no token now' : 'guard: the token changed, open pages are asked for it again')
  ctx.hub.closeAll()
}

export async function rebind(ctx: HostingContext): Promise<void> {
  let next: { host: string; port: number }
  try {
    next = listenOf(process.env)
  } catch (error) {
    ctx.listenError = noticeOf(error)
    console.error(`server: ${englishOf(ctx.listenError)}; staying on http://${ctx.listen.host}:${ctx.listen.port}`)
    return
  }
  if (next.host === ctx.listen.host && next.port === ctx.listen.port) {
    ctx.listenError = null
    return
  }
  const moved = createServer()
  for (const listener of ctx.server.listeners('request')) moved.on('request', listener as (...args: unknown[]) => void)
  try {
    await new Promise<void>((resolve, reject) => {
      moved.once('error', reject)
      moved.listen(next.port, next.host, () => resolve())
    })
  } catch (error) {
    ctx.listenError = notice('server.rebindFailed', { address: `${next.host}:${next.port}`, current: `${ctx.listen.host}:${ctx.listen.port}` }, { detail: (error as Error).message })
    console.error(englishOf(ctx.listenError))
    return
  }
  const old = ctx.server
  ctx.server = moved
  ctx.listen = next
  ctx.listenError = null
  ctx.hub.closeAll()
  old.close()
  old.closeAllConnections()
  console.log(`even-keel listening on http://${ctx.listen.host}:${ctx.listen.port}, moved from the previous address`)
}

export async function wireConfigStore(ctx: HostingContext): Promise<ConfigStore> {
  return await ConfigStore.open({
    db: ctx.db,
    writes: ctx.writes,
    intervalMs: ctx.CONFIG_POLL_MS,
    warn: (message) => console.warn(message),
    onChange: (before) => {
      if (before !== ctx.configStore.current) ctx.projectsChanged(before)
      ctx.dispatcher.setUnattended(ctx.configStore.current.unattended)
      ctx.dispatcher.setTrimTools(ctx.configStore.current.trimTools)
      for (const [project, tasks] of ctx.tasksByProject) ctx.dispatcher.setTasks(project, tasks)
      ctx.dispatcher.check()
      ctx.updates.configChanged()
      void ctx.applyTally()
      ctx.hub.broadcast('state', ctx.getState())
    },
  })
}
