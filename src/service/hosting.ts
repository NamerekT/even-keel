import { createServer } from 'node:http'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { answers } from '../account/network.js'
import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import { handoffsOf } from '../chain/launches.js'
import { mergeCheck } from '../chain/mainci.js'
import { pullReadiness } from '../review/open.js'
import { ConfigStore } from '../config-store.js'
import { DEFAULT_BRANCH, isPlain, listenOf, projectLabel, projectsByAccount, RULE_KEYS, runSettings } from '../config.js'
import { runGit } from '../git/run.js'
import { gitSetup } from '../git/setup.js'
import { withDismissed } from '../notice/kinds.js'
import { checkCopiesDir } from '../storage/backup.js'
import { saveBrowserHotkeys } from '../storage/browser-hotkeys.js'
import { englishOf, fail, notice, NoticeError, noticeOf } from '../notice/notice.js'
import { isBadgeSlug, isHttp } from '../badge/settings.js'
import { guardHosts, guardToken } from '../guard.js'
import { readJson } from '../packages/plugins.js'
import { checkDraft, checkRepo, isTrusted, sourcedDraft } from '../projects/check.js'
import { addProject } from '../projects/add.js'
import { creationPlan } from '../projects/creation.js'
import { cloner, restorer, sharedRemoteReader } from '../git/remote-run.js'
import { stepJobs } from '../jobs/runner.js'
import { trustFolder } from '../claude/trust.js'
import { gitSwitchBlock, turnGitOn, uncommittedChanges } from '../projects/git-mode.js'
import { removalBlock } from '../projects/removal.js'
import { remotesIn, sameRepository } from '../projects/remotes.js'
import { onMachines, poolControl } from './machine-pool.js'
import { machinePageControl } from './machine-page.js'
import { machineCards } from './machine-cards.js'
import { machineAbout } from '../machine/about.js'
import type { MachineAbout } from '../link/view.js'
import { installed } from '../updates/watcher.js'
import { createEvenKeelServer } from '../server.js'
import { answerComment, type AskAnswers } from '../sessions/ask.js'
import { fromCarried, type CarriedFile } from '../machine/services.js'
import { mailFor } from '../sessions/mailRelay.js'
import { handoffNoteOf } from '../sessions/note.js'
import type { TaskFile } from '../tracker/source.js'
import { TASKS_SERVER } from '../taskmcp/server.js'
import { guardsOwnAddress } from '../sessions/protection.js'
import { root, source, stateDirOf } from '../locations.js'
import { profileFor } from '../profiles/model.js'
import { cleanRules, projectRules, rulesWith } from '../profiles/rules.js'
import { checkMoves } from '../chain/moves.js'
import { profilesControl } from '../profiles/control.js'
import { disabledNotice } from '../profiles/service.js'
import { taskHistory } from './hosting-state.js'
import { Dictation } from '../dictation/transcribe.js'
import { withinWindow } from '../stats/checkpoint.js'
import { taskCheckpoint } from '../stats/task-checkpoint.js'
import { setStateValue } from '../storage/service-state.js'
import { checkServer, serverValues } from '../stats/connect.js'
import { readToolsView } from '../tools/panel.js'
import { ADAPTERS } from '../tracker/adapters.js'
import { hulyClient } from '../huly/client.js'
import { taskControl } from '../tracker/control.js'
import { runsAsService } from '../updates/control.js'
import type { ServiceContext } from '../service.js'
import { builtinControl, builtinPlaces } from '../builtin/control.js'
import { BuiltinExports } from '../builtin/export.js'
import { connectExportTarget } from '../tracker/export-target.js'
import { BuiltinImports } from '../builtin/import.js'
import { connectImportSource } from '../tracker/import-source.js'
import { attachmentsDirOf } from '../builtin/files.js'
import { BUILTIN } from '../builtin/model.js'
import { isChatSession } from '../chats/model.js'
import { runOf } from './demo.js'

export type HostingContext = Pick<ServiceContext,
  | 'CONFIG_POLL_MS'
  | 'FALLBACK_TOAST_MS'
  | 'LAUNCH_CHART_DAYS'
  | 'TRACKER_CHECK_MS'
  | 'account'
  | 'activeAccount'
  | 'agentOf'
  | 'answerSession'
  | 'badges'
  | 'applyTally'
  | 'approvals'
  | 'archive'
  | 'branchOf'
  | 'branches'
  | 'backups'
  | 'chainControl'
  | 'changelogs'
  | 'checkMergeTarget'
  | 'checkReports'
  | 'ciWatches'
  | 'claudeAccount'
  | 'claudeConfigs'
  | 'cliCopies'
  | 'cliChecks'
  | 'cliVersions'
  | 'configStore'
  | 'configuredProject'
  | 'machineLink'
  | 'daemons'
  | 'db'
  | 'demo'
  | 'dismissedUpdate'
  | 'dismissedNotices'
  | 'browserHotkeys'
  | 'dispatcher'
  | 'eventLog'
  | 'emailAt'
  | 'forwards'
  | 'getState'
  | 'homes'
  | 'hub'
  | 'inHomes'
  | 'inboxes'
  | 'launches'
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
  | 'projectChats'
  | 'projectsChanged'
  | 'promptLanguage'
  | 'protectionAudit'
  | 'intakeTemplateHits'
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
  | 'taskNote'
  | 'taskRuns'
  | 'tasksByProject'
  | 'runOfTask'
  | 'setTaskRun'
  | 'runsOfProject'
  | 'parentsByProject'
  | 'token'
  | 'trackers'
  | 'transcriptWatch'
  | 'updater'
  | 'updates'
  | 'vocabularies'
  | 'profileStatuses'
  | 'statusMover'
  | 'writes'
>

export { wireGetState } from './hosting-state.js'

/** A file the machine read, as the page's answer streams it. */
const taskFileOf = (file: CarriedFile | undefined): TaskFile | undefined => {
  if (file === undefined) return undefined
  const data = fromCarried(file)
  return { type: file.type, size: data.length, body: Readable.from([data]) }
}

export function wireServer(ctx: HostingContext): import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse> {
  const transcripts = ctx.machineLink.services.transcript
  const builtin = builtinControl({
    db: ctx.db,
    places: () => builtinPlaces(ctx.configStore.current),
    refresh: (project) => ctx.refreshProject(project),
    filesDir: attachmentsDirOf(stateDirOf()),
    limit: () => ctx.configStore.current.attachmentLimit * 1024 * 1024,
    busy: (task) =>
      ctx.dispatcher.state.active.some((chain) => chain.current?.task === task)
        ? 'current'
        : ctx.machineLink.page.liveView(task) !== undefined ? 'live' : null,
    renamed: (project, from, to) => ctx.configStore.renameMilestone(project, from, to),
  })
  const builtinExports = new BuiltinExports({
    db: ctx.db,
    places: () => builtinPlaces(ctx.configStore.current),
    filesDir: attachmentsDirOf(stateDirOf()),
    connect: (project, target) => connectExportTarget(ADAPTERS, ctx.profiles.current(), BUILTIN, project, target, ctx.TRACKER_CHECK_MS),
    refresh: (project) => ctx.refreshProject(project),
    event: (draft) => ctx.eventLog.add(draft),
    trackerTitle: (kind) => ADAPTERS[kind]?.title ?? kind,
    switching: {
      config: () => ctx.configStore.current,
      raw: () => ctx.configStore.raw(),
      profiles: () => ctx.profiles.current(),
      chain: () => ctx.dispatcher.state,
      rename: (project, names) => {
        ctx.dispatcher.rename(project, names)
        ctx.taskRuns.rename(project, names)
      },
      move: (project, move, profile) => {
        ctx.configStore.moveTracker(project, move, ctx.profiles.current().profiles.find((each) => each.id === profile)?.rules)
        ctx.profiles.link(project, profile)
      },
    },
  })
  const builtinImports = new BuiltinImports({
    db: ctx.db,
    filesDir: attachmentsDirOf(stateDirOf()),
    open: (project) => connectImportSource(ADAPTERS, ctx.profiles.current(), ctx.configStore.current, BUILTIN, project, ctx.TRACKER_CHECK_MS),
    refresh: (project) => ctx.refreshProject(project),
    event: (draft) => ctx.eventLog.add(draft),
    switching: {
      chain: () => ctx.dispatcher.state,
      rename: (project, names) => {
        ctx.dispatcher.rename(project, names)
        ctx.taskRuns.rename(project, names)
      },
      move: (project, move) => {
        ctx.configStore.moveTracker(project, move)
        ctx.profiles.link(project, null)
      },
    },
  })
  // The answer to a question goes into a built-in task's journal too, where the question was recorded (BTN-774).
  const journalAnswer = (project: string, task: string, answers: AskAnswers, text: string) => {
    const body = answerComment(answers, text, ctx.configStore.current.language ?? ctx.promptLanguage())
    if (body === null) return
    builtin.answered(project, task, body).catch((error: unknown) => {
      console.log(`tracker: ${task}: the answer was not written into the task's journal: ${englishOf(noticeOf(error))}`)
    })
  }
  const pool = poolControl({
    network: ctx.machineLink.network,
    own: () => ctx.machineLink.machines.own(),
    start: (plan) => void stepJobs.start(plan),
    factsOf: async (project) => {
      const repo = ctx.configStore.current.projects[project]
      if (repo === undefined) throw fail('machines.unknownProject', {})
      const claude = runSettings(ctx.configStore.current, project).provider === CLAUDE
      return { repo, remotes: await remotesIn(runGit, repo), branch: ctx.branchOf(project), claude }
    },
  })
  const network = ctx.machineLink.network
  let ownAbout: Promise<MachineAbout> | undefined
  const machinePage = machinePageControl({
    own: () => ctx.machineLink.machines.own(),
    record: (machine) => network.record(machine),
    online: (machine) => network.connected(machine),
    mirror: (machine) => ctx.machineLink.mirror(machine),
    ownAbout: () => {
      ownAbout ??= machineAbout({ evenKeel: installed(root).version, root: null, git: runGit, home: homedir() }).catch((error: unknown) => {
        ownAbout = undefined
        throw error
      })
      return ownAbout
    },
    parallel: () => ctx.configStore.current.parallel,
    setParallel: (count) => ctx.configStore.saveParallel(count),
    folders: (machine) => network.foldersOf(machine),
    colors: () => network.colors(),
    taken: (machine) => network.takenOn(machine),
    setCapacity: (machine, capacity) => network.setCapacity(machine, capacity),
    setColor: (machine, color) => network.setColor(machine, color),
    version: installed(root).version,
    polled: (account) => ctx.machineLink.polled(account),
    differs: (account) => ctx.machineLink.differs(account),
    log: (line) => console.log(line),
  })
  const cards = () => machineCards({
    own: () => ctx.machineLink.machines.own(),
    records: () => network.records(),
    online: (machine) => network.connected(machine),
    offlineSince: (machine) => network.offlineSince(machine),
    colors: () => network.colors(),
    folders: (machine) => network.foldersOf(machine),
    mirror: (machine) => ctx.machineLink.mirror(machine),
    ownAccounts: () => ctx.getState().account,
    ownGitUser: () => {
      const git = ctx.getState().git
      return git === undefined ? null : git.name !== null && git.email !== null
    },
    version: installed(root).version,
    now: () => Date.now(),
  })
  return createEvenKeelServer({
    cli: ctx.cliCopies,
    hulyClient,
    git: gitSetup,
    jobs: stepJobs,
    demo: ctx.demo,
    catchUp: async () => ctx.machineLink.port.catchUp?.(),
    hub: ctx.hub,
    publicDir: join(root, 'dist', 'web'),
    getState: ctx.getState,
    getTray: () => ({
      language: ctx.configStore.current.language,
      asking: ctx.machineLink.sessions.sessions().filter((session) => session.asking).length,
      paused: ctx.dispatcher.state.active.filter((chain) => chain.paused).length,
    }),
    control: ctx.chainControl,
    account: ctx.machineLink.services.account,
    sessions: {
      answer: async ({ project, task, sessionId, ask, answers, text, files, renew }) => {
        await ctx.answerSession(project, task, sessionId, ask, { from: 'page', answers, text, files }, renew)
        if (ask !== null) journalAnswer(project, task, answers, text)
      },
      dismissMail: async (sessionId) => {
        await ctx.machineLink.services.chat.dismiss(sessionId)
        ctx.hub.broadcastSoon('state', ctx.getState)
      },
    },
    settings: {
      save: async (project, form, base) => {
        if (ctx.configStore.current.projects[project] === undefined) throw fail('config.unknownProject', { key: project })
        const moved = form.tracker !== base.tracker || form.trackerProject !== base.trackerProject
        if (moved && ctx.lockedReaders().includes(project)) throw fail('config.trackerLocked', { key: projectLabel(ctx.configStore.current, project) })
        // Tasks of the built-in tracker do not move to another one yet: that is an export (BTN-769).
        const leaves = ctx.configStore.current.trackers[project] === BUILTIN && form.tracker !== BUILTIN
        if (leaves && (await builtin.holds(project))) throw fail('config.builtinLocked', { key: projectLabel(ctx.configStore.current, project) })
        if (form.pullRequests && !base.pullRequests) {
          const ready = ctx.pullReadinessOf(project, await remotesIn(runGit, form.repo))
          if ('notice' in ready) throw fail('review.cannotEnable', { project }, { cause: ready.notice })
        }
        if (form.mergeInto !== base.mergeInto || form.repo !== base.repo) await ctx.checkMergeTarget(project, form)
        const write = () => ctx.configStore.saveProject(project, form, base, profileFor(ctx.profiles.current(), project, ctx.configStore.current.trackers[project]!)?.rules)
        // Another main branch moves the main checkout first; git's refusal leaves the config as it was (BTN-754).
        const branch = form.branch.trim() || DEFAULT_BRANCH
        if (branch !== (base.branch.trim() || DEFAULT_BRANCH)) await ctx.branches.change(project, form.repo, branch, write)
        else write()
        console.log(`page: the settings of ${project} are written to the config`)
      },
      saveShared: (form, base) => {
        if (form.backup.dir !== base.backup.dir) checkCopiesDir(form.backup.dir)
        ctx.configStore.saveShared(form, base)
        console.log('page: the shared settings are written to the config')
      },
      check: async (draft, options) =>
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
            service: await runsAsService(),
          },
          draft,
          options,
        ),
      trust: async (project, account) => {
        const folder = ctx.configStore.current.projects[project]
        if (folder === undefined) throw fail('config.unknownProject', { key: project })
        const configs = ctx.claudeConfigs(account ?? runSettings(ctx.configStore.current, project).accounts[CLAUDE] ?? ctx.claudeAccount()).map(readJson)
        const trusted = configs.some((config) => isTrusted(config, folder))
        return { folder, trusted, platform: process.platform, user: userInfo().username, service: await runsAsService() }
      },
      branches: (project) => ctx.branches.branches(project),
      adoptBranch: (project) => ctx.branches.adopt(project),
      restoreBranch: (project) => ctx.branches.restore(project),
      add: async ({ machines, here, ...draft }) => {
        const plan = await creationPlan(
          {
            git: runGit,
            clone: cloner(),
            restore: restorer(),
            readRemote: sharedRemoteReader,
            check: (each) => checkRepo(runGit, each, ctx.configStore.raw(), process.platform),
            add: (each) => addProject({ configStore: ctx.configStore, profiles: ctx.profiles, git: runGit }, each),
            folderOf: (project) => ctx.configStore.current.projects[project]!,
            trustFiles: (each) => {
              const run = runSettings(ctx.configStore.current, undefined)
              return (each.provider ?? run.provider) === CLAUDE ? ctx.claudeConfigs() : []
            },
            trust: (file, folder) => trustFolder(file, folder),
            packages: ctx.packages,
          },
          // The wizard's one field read into the source the steps take (BTN-1093).
          await sourcedDraft(runGit, draft, ctx.configStore.raw()),
        )
        stepJobs.start(machines === undefined || machines.length === 0 ? plan : await onMachines(pool.deps, plan, machines, here !== false))
      },
      remove: (project) => {
        const repo = ctx.configStore.current.projects[project]
        if (repo === undefined) throw fail('config.unknownProject', { key: project })
        const blocked = removalBlock(ctx.removalFacts(project, repo))
        if (blocked !== null) throw new NoticeError(blocked)
        ctx.configStore.removeProject(project)
        console.log(`page: the project ${project} is removed from the config; its repository, worktrees and branches are left as they are`)
      },
      gitChanges: async (project) => {
        const repo = ctx.configStore.current.projects[project]
        if (repo === undefined) throw fail('config.unknownProject', { key: project })
        if (ctx.configStore.view().projects[project]!.git) return { files: [] }
        return { files: await uncommittedChanges(runGit, repo) }
      },
      turnGitOn: async (project, { slot, commit, branch: taken }) => {
        const config = ctx.configStore.current
        const repo = config.projects[project]
        if (repo === undefined) throw fail('config.unknownProject', { key: project })
        if (!Number.isInteger(slot) || slot < 0) throw fail('request.required', { field: 'slot' })
        const label = projectLabel(config, project)
        const inHand = ctx.dispatcher.state.active.find((chain) => chain.project === project)?.current?.task ?? null
        const blocked = gitSwitchBlock({ ...ctx.removalFacts(project, repo), project: label }, inHand)
        if (blocked !== null) throw new NoticeError(blocked)
        const base = ctx.configStore.view().projects[project]!
        if (base.git) return
        const branch = taken?.trim() || base.branch.trim() || DEFAULT_BRANCH
        const { made, committed } = await turnGitOn(runGit, repo, label, branch, { commit })
        // The entry may still carry a slot count the mode without git ignored: the chosen one is written over it.
        const rules = profileFor(ctx.profiles.current(), project, ctx.configStore.current.trackers[project]!)?.rules
        const saved = taken?.trim() ? { ...base, branch } : base
        ctx.configStore.saveProject(project, { ...saved, git: true, slot }, { ...base, slot: -1 }, rules)
        const how = made ? ', its folder made a repository with a first commit' : committed ? ', the work done without git committed' : ''
        console.log(`page: git is on for ${label}${how}`)
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
      feedRules: (project, feed, rules) => {
        const found = ctx.configStore.current.feeds[project]?.find((each) => each.id === feed)
        if (found === undefined) throw fail('config.unknownFeed', {})
        projectRules(ctx.configStore.current, ctx.profiles.current(), project, { ...found, chain: cleanRules(rules, RULE_KEYS) })
        ctx.configStore.saveFeedRules(project, feed, rules)
        console.log(`page: the chain rules of the task feed ${found.key} of ${projectLabel(ctx.configStore.current, project)} are written to the config`)
      },
      profileMoves: async (id, moves) => {
        const profile = ctx.profiles.current().profiles.find((each) => each.id === id)
        if (profile === undefined) throw fail('profiles.unknown', {})
        const statuses = (await ctx.profileStatuses.get(id).catch(() => undefined)) ?? []
        checkMoves(rulesWith(ctx.configStore.current.chain, {}, profile.rules), moves, statuses)
        ctx.profiles.setMoves(id, moves)
        console.log(`page: the status moves of the profile ${profile.name} are saved`)
      },
      sourceMoves: async (project, feed, moves) => {
        const config = ctx.configStore.current
        const found = feed === null ? undefined : config.feeds[project]?.find((each) => each.id === feed)
        if (feed !== null && found === undefined) throw fail('config.unknownFeed', {})
        const set = ctx.profiles.current()
        const profile = profileFor(set, found?.id ?? project, found?.tracker ?? config.trackers[project] ?? '')
        const statuses = profile === undefined ? [] : ((await ctx.profileStatuses.get(profile.id).catch(() => undefined)) ?? [])
        checkMoves(projectRules(config, set, project, found), moves, statuses)
        ctx.configStore.saveMoves(project, feed, moves)
        console.log(`page: the status moves of ${found === undefined ? 'the main tracker' : `the task feed ${found.key}`} of ${projectLabel(config, project)} are written to the config`)
      },
      milestoneOrder: (project, labels) => {
        ctx.configStore.saveMilestoneOrder(project, labels)
        const label = projectLabel(ctx.configStore.current, project)
        console.log(labels.length === 0 ? `page: the milestone order of ${label} is back to automatic` : `page: the milestone order of ${label} is written to the config`)
      },
      badge: (project, badge) => {
        if (badge !== null && typeof badge.url === 'string' && badge.url.trim() !== '' && !isHttp(badge.url.trim())) throw fail('badge.url', {})
        if (badge !== null && typeof badge.slug === 'string' && badge.slug.trim() !== '' && !isBadgeSlug(badge.slug.trim().toLowerCase())) throw fail('badge.slug', {})
        ctx.configStore.saveBadge(project, badge)
        console.log(`page: the README badge of ${projectLabel(ctx.configStore.current, project)} is written to the config`)
        void ctx.badges.tick()
      },
      checkBadge: (project, url, slug) => ctx.badges.check(project, url, slug),
      dismissUpdate: (version) => {
        ctx.dismissedUpdate = version
        ctx.writes.add('the dismissed update', setStateValue(ctx.db, 'updates.dismissed', version))
        ctx.hub.broadcastSoon('state', ctx.getState)
      },
      dismissNotices: (entries) => {
        ctx.dismissedNotices = withDismissed(ctx.dismissedNotices, entries)
        ctx.writes.add('the dismissed notices', setStateValue(ctx.db, 'notices.dismissed', ctx.dismissedNotices))
        ctx.hub.broadcastSoon('state', ctx.getState)
      },
      saveHotkeys: (browser, bindings) => {
        const { [browser]: _, ...rest } = ctx.browserHotkeys
        ctx.browserHotkeys = Object.keys(bindings).length === 0 ? rest : { ...rest, [browser]: bindings }
        ctx.writes.add('the hotkeys', saveBrowserHotkeys(ctx.db, browser, bindings, new Date()))
        ctx.hub.broadcastSoon('state', ctx.getState)
      },
      muteNotice: (project, kind, shown) => {
        ctx.configStore.saveNotice(project, kind, shown)
        console.log(`page: the notice ${kind} is ${shown === null ? 'back to the shared value' : shown ? 'shown' : 'turned off'} for ${project === null ? 'Even Keel' : projectLabel(ctx.configStore.current, project)}`)
      },
      showTests: (page, on) => ctx.configStore.saveSwitches(page === 'home' ? { homeShowTests: on } : { statsShowTests: on }),
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
    history: { events: () => ctx.eventLog.entries, task: (task) => taskHistory(ctx, task) },
    sessionRecord: (sessionId) => transcripts.record(sessionId),
    transcript: (sessionId, after) => transcripts.feed(sessionId, after),
    transcriptImage: async (sessionId, tool, index) => taskFileOf(await transcripts.image(sessionId, tool, index)),
    inboxFile: async (sessionId, name) => taskFileOf(await transcripts.inboxFile(sessionId, name)),
    sharedFile: async (sessionId, tool, index) => taskFileOf(await transcripts.sharedFile(sessionId, tool, index)),
    checkpoint: async (sessionId) => {
      const run = handoffsOf(ctx.launches, sessionId)
      if (run === undefined) return undefined
      const view = ctx.machineLink.sessions.sessions().find((each) => each.sessionId === sessionId)
      const { context, compactAt } = await transcripts.context(sessionId)
      const window = view?.contextWindow ?? null
      const task = ctx.tasksByProject.get(run.project)?.find((each) => each.id === run.task)
      const pinned = taskCheckpoint(ctx.pinnedCheckpoint(run.project), task?.labels)
      const { first, source } = await ctx.stats.checkpoint(ctx.configStore.current.keys[run.project] ?? run.project, pinned)
      const settings = ctx.configStore.current.settings[run.project]
      const shares = settings?.checkpointShares ?? ctx.configStore.current.stats.checkpointShares
      const threshold = withinWindow({ first, source }, window, shares, view?.agent ?? null, compactAt)
      const off = !(settings?.contextHandoffs ?? ctx.configStore.current.contextHandoffs)
      const note = handoffNoteOf(run.task, !isPlain(ctx.configStore.current, run.project), ctx.packages.bringsServer(run.project, TASKS_SERVER))
      return { ...run, ...threshold, ...(off ? { source: 'off' as const } : {}), context, note }
    },
    handoffNote: async (sessionId) => (handoffsOf(ctx.launches, sessionId) === undefined ? undefined : transcripts.note(sessionId)),
    mail: (sessionId, event) => (handoffsOf(ctx.launches, sessionId) === undefined && !isChatSession(ctx.machineLink.sessions.sessions(), sessionId) ? undefined : mailFor(ctx.mailRelay, sessionId, event)),
    mailContext: (sessionId, event) => (event === 'PreToolUse' || event === 'PostToolUse' ? ctx.badges.statusAsk(sessionId) : null),
    inbox: (sessionId, socket, token) => ctx.inboxes.remember(sessionId, socket, token),
    permission: (sessionId, tool, input, since) => (handoffsOf(ctx.launches, sessionId) === undefined ? undefined : ctx.approvals.poll(sessionId, tool, input, since)),
    mergeCheck: (sessionId) => {
      const run = handoffsOf(ctx.launches, sessionId)
      if (run === undefined) return undefined
      const settings = ctx.configStore.current.settings[run.project]
      const views = ctx.ciWatches.shown(run.project).map((watch) => watch.view)
      const commands = settings === undefined ? [] : mergeCheck(settings.check, settings.ci, views)
      const protection = settings?.protection ?? ctx.configStore.current.protection
      return {
        commands,
        branch: ctx.branchOf(run.project),
        standards: settings?.standards ?? [],
        ...(isPlain(ctx.configStore.current, run.project) ? { git: false as const } : {}),
        ...(guardsOwnAddress(protection) ? { ownAddress: true as const } : {}),
      }
    },
    checkReport: (sessionId, report) => {
      const run = handoffsOf(ctx.launches, sessionId)
      if (run === undefined) return false
      ctx.checkReports.report(run.project, run.task, report)
      return true
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
        plain: isPlain(ctx.configStore.current, project),
      })
      const received = view.received
      return received === null ? view : { ...view, received: { ...received, account: ctx.sessionAccount(received.sessionId, received.at) } }
    },
    vocabulary: (id) => {
      if (!Object.hasOwn(ctx.readers().projects, id)) return Promise.resolve(undefined)
      const off = disabledNotice(ctx.profiles.disabledFor(id))
      return off === undefined ? ctx.vocabularies.get(id) : Promise.reject(new NoticeError(off))
    },
    profileStatuses: (id) => {
      const off = disabledNotice(ctx.profiles.current().profiles.find((profile) => profile.id === id && profile.disabled))
      return off === undefined ? ctx.profileStatuses.get(id) : Promise.reject(new NoticeError(off))
    },
    builtin,
    builtinExports,
    builtinImports,
    chats: ctx.projectChats,
    dictation: new Dictation(() => ctx.db),
    backup: ctx.backups,
    machines: ctx.machineLink.network,
    pool,
    machinePage,
    machineCards: cards,
    models: async (key) => {
      const home = ctx.homes.find(key)
      return home === undefined ? null : ctx.models.of(home)
    },
    tasks: taskControl({
      configuredProject: ctx.configuredProject, linkFor: ctx.linkFor, disabled: (reader) => disabledNotice(ctx.profiles.disabledFor(reader)), rulesOf: ctx.rulesOf, readerFor: ctx.readerFor, refreshers: ctx.refreshers, readerTasks: ctx.readerTasks, refreshProject: ctx.refreshProject,
      live: (task) => ctx.machineLink.page.liveView(task) !== undefined,
      pollReviews: (project) => ctx.dispatcher.pollReviews(project),
      setRun: (project, task, run) => ctx.setTaskRun(project, task, run),
      runOf: (project, task) => ctx.runOfTask(project, task),
      broadcast: () => ctx.hub.broadcastSoon('state', ctx.getState),
    }),
    changelog: async (project, milestone, op) => {
      if (!Object.hasOwn(ctx.configStore.current.projects, project)) throw fail('chain.unknownProject', { project })
      const view = await ctx.changelogs.run(project, milestone, op)
      if (op.op === 'write') ctx.hub.broadcastSoon('state', ctx.getState)
      return view
    },
    carry: (project) => ctx.forwards.carry(project),
    resolveCarry: (project) => ctx.forwards.resolve(project),
    stats: ctx.stats,
    badge: (project, theme, still) => ctx.badges.svg(project, theme, still),
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
  // A `--bg` daemon gives its sessions the environment it started with, the old `EVEN_KEEL_URL` too (BTN-817).
  for (const home of ctx.homes.list()) if (ctx.agentOf(home).stopDaemon !== undefined) void ctx.daemons.expire(home)
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
      void ctx.machineLink.network.apply()
      ctx.eventLog.settingsSeen(ctx.configStore.raw())
      ctx.hub.broadcastSoon('state', ctx.getState)
    },
  })
}
