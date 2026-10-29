import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type AccountHome } from '../account/homes.js'
import { accountAt } from '../account/ledger.js'
import { accountId, launchBlock } from '../account/model.js'
import type { SessionStart } from '../agent/contract.js'
import { sessionBase } from '../agent/env.js'
import { Dispatcher, type LaunchEntry } from '../chain/dispatcher.js'
import { carryNameOf, fixNameOf, isCarryName, isFixName, isOwnName, projectOfCarry, projectOfFix } from '../chain/fix.js'
import { chainQuiet, ForwardMerger } from '../chain/forward.js'
import { PROMPTS } from '../chain/prompts.js'
import { carryPrompt, fixPrompt, noteOf, resumePrompt, startPrompt, withBrief, withPrompts, withTracker, type HandoffSession } from '../chain/relay.js'
import { launchLine } from '../chain/log.js'
import { mainCheckDeps } from '../chain/mainci.js'
import { TaskPlaces } from '../chain/places.js'
import { readNote, saveSnapshot, snapshotReason } from '../chain/snapshots.js'
import { reviewDeps } from '../review/wiring.js'
import { appendLaunch, loadChainState, saveChainState, saveClosedTask } from '../chain/store.js'
import { ChangelogDrafts } from '../changelog/drafts.js'
import { DEFAULT_CHANGELOG } from '../changelog/file.js'
import { changesOf } from '../git/changes.js'
import { TaskWorks, worksOf } from '../git/work.js'
import { commitChangelog } from '../git/changelog.js'
import { gitlabUrls } from '../ci/adapters.js'
import { createCiWatches } from '../ci/wiring.js'
import { DEFAULT_BRANCH, DEFAULT_CI, mergeTargetOf, projectLabel } from '../config.js'
import { runGit } from '../git/run.js'
import { finishSlot, heldSlot, prepareSlot, slotPaths, type SlotUse } from '../git/slot.js'
import { fastForwardMain, syncMain } from '../git/sync.js'
import { ensureIgnored, finishWorktree, prepareWorktree, requireBranch, requireCheckedOut, taskPlace } from '../git/worktree.js'
import { exhaustedReset } from '../limits/model.js'
import { overageSession } from '../limits/overage-session.js'
import { englishOf, fail, notice, noticeOf, type Notice } from '../notice/notice.js'
import { type RemovalFacts } from '../projects/removal.js'
import { checkoutRemotes, remotePeers, repositoryIds, sameRepository } from '../projects/remotes.js'
import { replyParts } from '../sessions/ask.js'
import { isLive } from '../sessions/agents.js'
import { accountEnv, runAfterGreen, runBeforeStart, runCheck, systemShell, type SetupRun } from '../sessions/setup.js'
import { KEEP_WARM_PROMPT, KeepWarm, warmTasks, type WarmFacts } from '../sessions/keepwarm.js'
import { isInside } from '../paths.js'
import { profileFor } from '../profiles/model.js'
import { slotOccupants } from '../sessions/occupants.js'
import { locateWorktree } from '../sessions/place.js'
import type { ProjectForm } from '../state.js'
import { issueLink } from '../tracker/model.js'
import type { ServiceContext } from '../service.js'

type ChainContext = Pick<ServiceContext,
  | 'CHANGELOG_TIMEOUT_MS'
  | 'CI_TIMEOUT_MS'
  | 'WORK_TTL_MS'
  | 'account'
  | 'accountNow'
  | 'agentExtras'
  | 'agentOf'
  | 'agentStatus'
  | 'agents'
  | 'approvals'
  | 'approved'
  | 'archive'
  | 'archiveClosed'
  | 'branchOf'
  | 'briefOn'
  | 'briefed'
  | 'choiceFor'
  | 'ciTokenOf'
  | 'ciWatches'
  | 'cliCopies'
  | 'cliLease'
  | 'configStore'
  | 'configuredProject'
  | 'daemons'
  | 'db'
  | 'dispatcher'
  | 'envOf'
  | 'getState'
  | 'goOnWith'
  | 'homeOf'
  | 'homes'
  | 'hub'
  | 'keepWarm'
  | 'launchIn'
  | 'launches'
  | 'ledger'
  | 'limits'
  | 'linkFor'
  | 'linkOf'
  | 'liveView'
  | 'mailbox'
  | 'monitor'
  | 'noAccountFor'
  | 'occupantsOf'
  | 'packages'
  | 'places'
  | 'planFor'
  | 'profileBlock'
  | 'profiles'
  | 'projectOf'
  | 'promptLanguage'
  | 'pullBlock'
  | 'pullRefusals'
  | 'pullRequestsOn'
  | 'readerFor'
  | 'readers'
  | 'refreshProject'
  | 'remotes'
  | 'resumeIn'
  | 'resumeWith'
  | 'retryAfterLimit'
  | 'rulesOf'
  | 'sameRepositoryOf'
  | 'sessions'
  | 'settingsFor'
  | 'slotSpan'
  | 'slotUse'
  | 'slotsSeen'
  | 'stopIn'
  | 'stopTaskSessions'
  | 'syncProject'
  | 'taskRun'
  | 'taskSource'
  | 'tasksByProject'
  | 'trackerPlace'
  | 'trackers'
  | 'vacateSlot'
  | 'warmable'
  | 'withProject'
  | 'withSource'
  | 'works'
  | 'writes'
>

export function wireChangelogs(ctx: ChainContext): ChangelogDrafts {
  return new ChangelogDrafts({
    tasks: async (project, milestone) => {
      const link = ctx.linkOf(project)
      if (link === undefined) throw fail('tracker.noProject', { project })
      const tasks = await link.run(async (tracker) => tracker.milestoneTasks?.(project, milestone))
      if (tasks === undefined) throw fail('changelog.cannotList', { project })
      return tasks
    },
    write: async (project, prompt) => {
      const { account, model } = ctx.choiceFor(project)
      const home = ctx.homeOf(account)
      const agent = ctx.agentOf(home)
      if (agent.write === undefined) throw fail('changelog.noAgent', { project })
      console.log(`changelog: ${project} writes a draft on ${home.key}`)
      try {
        const { text, spend } = await agent.write(home, { cwd: ctx.configStore.current.projects[project]!, prompt, model, timeoutMs: ctx.CHANGELOG_TIMEOUT_MS })
        console.log(`changelog: ${project} draft on ${home.key} cost ${spend.cost === null ? 'unknown' : `$${spend.cost.toFixed(2)}`}`)
        return { text, spend: { ...spend, account: home.key } }
      } catch (error) {
        throw fail('changelog.failed', { project }, { detail: error instanceof Error ? error.message : String(error) }, { cause: error })
      }
    },
    file: async (project) => {
      const path = ctx.configStore.current.settings[project]?.changelog ?? DEFAULT_CHANGELOG
      const file = join(ctx.configStore.current.projects[project]!, ...path.split('/'))
      const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      return { path, text: text?.replace(/\r\n/g, '\n') ?? null }
    },
    tags: async (project) => {
      const listed = await runGit(ctx.configStore.current.projects[project]!, ['tag', '--list'])
      return listed.code === 0 ? listed.out.split('\n').map((tag) => tag.trim()).filter(Boolean) : []
    },
    commit: async (project, path, message, change) => {
      const sha = await commitChangelog(runGit, ctx.configStore.current.projects[project]!, { branch: ctx.branchOf(project), path, message, change })
      console.log(sha === null ? `changelog: ${project} ${path} is already as written` : `changelog: ${project} committed ${path} as ${sha.slice(0, 7)}`)
      return sha
    },
    db: ctx.db,
    now: () => new Date(),
  })
}

export function wireBriefed(ctx: ChainContext): (task: string, given: string, project?: string | undefined) => Promise<string> {
  return async (task: string, given: string, project = ctx.projectOf(task)): Promise<string> => {
    if (project === undefined) return given
    const reader = ctx.readerFor(project, task)
    const prompt = withTracker(given, ctx.trackerPlace(reader), ctx.promptLanguage(project))
    if (!ctx.briefOn(project, reader)) return prompt
    const link = ctx.linkOf(reader)
    return link === undefined ? prompt : withBrief(prompt, await link.run(async (tracker) => tracker.brief?.(task)), ctx.promptLanguage(project))
  }
}

export function wireWithProject(ctx: ChainContext): (prompt: string, project: string | undefined) => string {
  return (prompt: string, project: string | undefined): string => {
    const config = ctx.configStore.current
    const own = project === undefined ? null : (config.settings[project]?.prompt ?? null)
    return withPrompts(prompt, { shared: config.prompt, project: own }, ctx.promptLanguage(project))
  }
}

export function wirePlaces(ctx: ChainContext): TaskPlaces {
  return new TaskPlaces({
    git: runGit,
    main: ctx.branchOf,
    place: async (project, task, { ahead = false, at } = {}) => {
      const repo = ctx.configStore.current.projects[project]!
      const main = ctx.branchOf(project)
      await requireBranch(runGit, repo, project, main)
      if (!ahead) await requireCheckedOut(runGit, repo, project, main)
      await ensureIgnored(runGit, repo)
      // Not ahead: while the chain waits for the CI or the commands after green, main must stay at the commit they judge.
      if (!ahead) await fastForwardMain(runGit, repo, main)
      const count = ctx.configStore.current.slots[project]
      const span = ctx.slotSpan(project)
      if (isOwnName(task)) return prepareWorktree(runGit, repo, task, main, ahead)
      if (count === undefined) return (span > 0 ? await heldSlot(runGit, repo, task, span) : undefined) ?? prepareWorktree(runGit, repo, task, main, ahead)
      const pool = { count, span, main, ahead, occupancy: (path: string) => ctx.slotUse(path, task), vacate: (path: string) => ctx.vacateSlot(path, task) }
      return prepareSlot(runGit, repo, task, at === undefined ? pool : { ...pool, at })
    },
    setUp: (project, task, path) => runBeforeStart(ctx.configStore.current.settings[project]?.beforeStart ?? [], ctx.taskRun(task, path, ctx.choiceFor(project, task).account)),
  })
}

export function archiveClosed(ctx: ChainContext, project: string, task: string): void {
  const { tracker, profile, url } = ctx.taskSource(project, task)
  const known = ctx.tasksByProject.get(project)?.find((each) => each.id === task)
  const closed = { project, task, tracker, title: known?.title ?? '', url, closedAt: new Date().toISOString(), profile, status: known?.status.name ?? null }
  ctx.writes.add(`the archive of ${task}`, saveClosedTask(ctx.db, closed))
  const at = ctx.archive.findIndex((each) => each.project === project && each.task === task)
  if (at >= 0) ctx.archive.splice(at, 1)
  ctx.archive.push(closed)
}

export function withSource(ctx: ChainContext, entry: LaunchEntry): LaunchEntry {
  if (isOwnName(entry.task) || ctx.configStore.current.projects[entry.project] === undefined) return entry
  const { profile, url } = ctx.taskSource(entry.project, entry.task)
  const title = ctx.tasksByProject.get(entry.project)?.find((each) => each.id === entry.task)?.title
  return { ...entry, ...(profile === null ? {} : { profile }), ...(url === null ? {} : { url }), ...(title === undefined ? {} : { title }) }
}

export function taskSource(ctx: ChainContext, project: string, task: string): { tracker: string; profile: string | null; url: string | null } {
  const reader = ctx.readerFor(project, task)
  const tracker = ctx.readers().trackers[reader]!
  return {
    tracker,
    profile: profileFor(ctx.profiles.current(), reader, tracker)?.id ?? null,
    url: issueLink(ctx.trackers.setupOf(reader)?.issueUrl(reader) ?? null, task),
  }
}

export function taskRun(ctx: ChainContext, task: string, cwd: string, account: string): SetupRun {
  const env = () => accountEnv(account, (key) => ctx.homes.find(key), ctx.envOf, sessionBase(process.env, ctx.packages.keyNames()))
  return { task, cwd, shell: systemShell(env), log: (line) => console.log(line) }
}

export async function syncProject(ctx: ChainContext, project: string): Promise<Notice | null> {
  const repo = ctx.configStore.current.projects[project]!
  const remotes = (await runGit(repo, ['remote'])).out.split(/\s+/).filter(Boolean)
  return remotes.length === 0 ? null : syncMain(runGit, repo, remotes, ctx.branchOf(project))
}

export function wireKeepWarm(ctx: ChainContext): KeepWarm {
  return new KeepWarm({
    hours: () => ctx.configStore.current.keepWarm,
    sessions: (): WarmFacts[] =>
      warmTasks(ctx.dispatcher.state).flatMap((each) => {
        const view = ctx.warmable(each)
        if (view === undefined) return []
        const busy = ctx.agentStatus(view.task) === 'busy' || ctx.monitor.holds.held(view.sessionId)
        return [{ task: view.task, sessionId: view.sessionId, busy, limited: view.lamp === 'limit', cache: view.cache }]
      }),
    ping: async ({ task, sessionId }) => {
      const view = ctx.warmable({ task, sessionId })
      const session = ctx.monitor.handoff(task)
      if (view === undefined || session === undefined) throw new Error(`the session ${sessionId} is not live`)
      const home = ctx.homeOf(session.account)
      const start: SessionStart = { name: task, cwd: session.cwd, prompt: KEEP_WARM_PROMPT, model: view.model, settings: ctx.settingsFor(task), ...ctx.agentExtras(home, ctx.projectOf(task), task) }
      return ctx.agentOf(home).warm!(home, session, start)
    },
    now: () => new Date(),
    log: (line) => console.log(line),
  })
}

export async function wireDispatcher(ctx: ChainContext): Promise<Dispatcher> {
  return new Dispatcher(await loadChainState(ctx.db), {
    projects: () => Object.keys(ctx.configStore.current.projects),
    parallel: () => ctx.configStore.current.parallel,
    rules: ctx.rulesOf,
    fillsMilestone: (project) => ctx.configStore.current.settings[project]?.fillMilestone ?? false,
    launch: async (project, task, extra) => {
      const home = ctx.homeOf(ctx.choiceFor(project, task).account)
      await ctx.daemons.prepare(home)
      const place = await ctx.places.ready(project, task)
      const started = ctx.withProject(await ctx.briefed(task, startPrompt(task, place, ctx.promptLanguage(project), ctx.branchOf(project), ctx.pullRequestsOn(project)), project), project)
      const { prompt, model, provider, fallback } = ctx.planFor(task, extra === undefined ? started : `${started}\n${extra}\n`, project)
      const extras = ctx.agentExtras(home, project, task)
      const sessionId = await ctx.launchIn(home, { name: task, cwd: place.path, prompt, model, settings: ctx.settingsFor(task, project), ...extras }, project)
      if (fallback === null) return { sessionId }
      console.warn(englishOf(ctx.noAccountFor(task, fallback, provider)))
      return { sessionId, fallback }
    },
    liveSession: (task) => ctx.sessions.find((view) => view.task === task && view.lamp !== 'finished')?.sessionId,
    blocked: (project, task) => ctx.profileBlock(project) ?? ctx.pullBlock(project) ?? ctx.cliCopies.blocked(ctx.choiceFor(project, task).provider) ?? launchBlock(ctx.account.view, ctx.choiceFor(project, task).account),
    busy: (task) => {
      const status = ctx.agentStatus(task)
      return status === 'busy' || status === 'waiting'
    },
    midTurn: (task) => ctx.agentStatus(task) === 'busy',
    silentSince: (task) => ctx.liveView(task)?.silentSince ?? null,
    shell: (task) => {
      const view = ctx.liveView(task)
      return view !== undefined && ctx.agents.find((agent) => agent.sessionId === view.sessionId)?.status === 'shell'
    },
    asked: (task) => ctx.liveView(task)?.ask?.id ?? null,
    save: (state) => {
      ctx.writes.add('the chain state', saveChainState(ctx.db, state))
      ctx.hub.broadcast('state', ctx.getState())
    },
    journal: (launched) => {
      const entry = ctx.withSource(launched)
      ctx.writes.add(`the launch of ${entry.task}`, appendLaunch(ctx.db, entry))
      ctx.launches.push(entry)
      console.log(launchLine(entry))
    },
    now: () => new Date(),
    limited: (task) => ctx.monitor.limited(task),
    overage: (task) => {
      const session = ctx.monitor.handoff(task)
      const entry = ctx.account.view.accounts.find((entry) => entry.key === session?.account)
      const home = entry === undefined ? undefined : ctx.homes.find(entry.key)
      const account = entry === undefined ? undefined : { ...entry, apiKey: entry.apiKey && (home === undefined || ctx.agentOf(home).keyUsage !== true) }
      return overageSession(session, ctx.agents.find((agent) => agent.sessionId === session?.sessionId), account, new Date())
    },
    handoff: (task) => {
      const session = ctx.monitor.handoff(task)
      return session === undefined ? undefined : { ...session, warmedAt: ctx.keepWarm.warmedAt(session.sessionId) }
    },
    locate: locateWorktree,
    account: (project, task) => {
      const key = ctx.choiceFor(project, task).account
      const now = ctx.accountNow(key)
      const home = ctx.homes.find(key)
      // A resume waits out the CLI check holding the folder (BTN-569), as it waits out a sign-in.
      return home !== undefined && ctx.cliLease.held(home) ? { ...now, ready: false } : now
    },
    accountAt: (key, at) => accountId(key, accountAt(ctx.ledger, key, at)),
    limitReset: (project, task) => exhaustedReset(ctx.limits.limits(ctx.choiceFor(project, task).account)),
    limitResetAfter: ctx.retryAfterLimit,
    packagesBlocked: (project) => ctx.packages.blocked(project),
    accountsRead: () => ctx.account.ready,
    promptLanguage: (task) => ctx.promptLanguage(ctx.projectOf(task)),
    mainBranch: (task) => {
      const project = ctx.projectOf(task)
      return project === undefined ? DEFAULT_BRANCH : ctx.branchOf(project)
    },
    pullRequests: (task) => {
      const project = ctx.projectOf(task)
      return project !== undefined && ctx.pullRequestsOn(project)
    },
    resume: (task, session) => ctx.resumeWith(task, session, resumePrompt(ctx.promptLanguage(ctx.projectOf(task)))),
    reply: (task, session, prompt) => ctx.resumeWith(task, session, prompt),
    relay: async (task, session, handoff, reason) => {
      const previous = ctx.homes.find(session.account)
      if (previous !== undefined && !session.stopped) await ctx.stopIn(previous, session)
      const project = ctx.projectOf(task)
      const home = ctx.homeOf(ctx.choiceFor(project, task).account)
      await ctx.daemons.prepare(home)
      const told = isOwnName(task) ? handoff : await ctx.briefed(task, handoff)
      const { prompt, model } = ctx.planFor(task, ctx.withProject(told, project), project)
      const notePath = noteOf(session)
      const note = await readNote(notePath)
      const at = new Date().toISOString()
      const extras = ctx.agentExtras(home, project, task)
      const sessionId = await ctx.launchIn(home, { name: task, cwd: session.workdir, prompt, model, settings: ctx.settingsFor(task, project), ...extras }, project)
      const snapshot = { at, task, sessionId, previous: session.sessionId, reason: snapshotReason(reason), prompt, notePath, note }
      ctx.writes.add(`the handoff snapshot of ${task}`, saveSnapshot(ctx.db, snapshot))
      return sessionId
    },
    launchFix: async (project, name, report) => {
      const home = ctx.homeOf(ctx.choiceFor(project).account)
      await ctx.daemons.prepare(home)
      const place = await ctx.places.ready(project, name)
      const { prompt, model } = ctx.planFor(name, ctx.withProject(fixPrompt(report, place, ctx.promptLanguage(project), ctx.branchOf(project)), project), project)
      const extras = ctx.agentExtras(home, project, name)
      return ctx.launchIn(home, { name, cwd: place.path, prompt, model, settings: ctx.settingsFor(name, project), ...extras }, project)
    },
    launchCarry: async (project, name, report) => {
      const home = ctx.homeOf(ctx.choiceFor(project).account)
      await ctx.daemons.prepare(home)
      const place = await ctx.places.ready(project, name)
      const { prompt, model } = ctx.planFor(name, ctx.withProject(carryPrompt(report, place, ctx.promptLanguage(project), ctx.branchOf(project)), project), project)
      const extras = ctx.agentExtras(home, project, name)
      return ctx.launchIn(home, { name, cwd: place.path, prompt, model, settings: ctx.settingsFor(name, project), ...extras }, project)
    },
    carried: async (project, commit) =>
      (await runGit(ctx.configStore.current.projects[project]!, ['merge-base', '--is-ancestor', commit, `refs/heads/${ctx.branchOf(project)}`])).code === 0,
    stop: (session) => ctx.stopIn(ctx.homeOf(session.account), session),
    finish: async (project, task, pull) => {
      if (!isOwnName(task) && pull?.unmerged !== true) ctx.archiveClosed(project, task)
      const repo = ctx.configStore.current.projects[project]!
      const span = isOwnName(task) ? 0 : ctx.slotSpan(project)
      let stopped: Notice[]
      let finished: Awaited<ReturnType<typeof finishWorktree>>
      try {
        stopped = await ctx.stopTaskSessions(repo, task, Math.max(span, 1))
        const main = ctx.branchOf(project)
        const drop = pull === undefined ? {} : { force: pull.force, remote: pull.remote }
        finished = await (span > 0 ? finishSlot(runGit, repo, task, span, main, drop) : finishWorktree(runGit, repo, task, main, drop))
      } catch (error) {
        console.error(`git: cleanup after ${task} failed: ${englishOf(noticeOf(error))}`)
        throw error
      }
      ctx.packages.release(project, task)
      const outcome = { ...finished, warnings: [...stopped, ...finished.warnings] }
      for (const warning of outcome.warnings) console.warn(`git: ${task}: ${englishOf(warning)}`)
      if (outcome.syncError !== null) console.error(`git: sync of ${project} after ${task} failed: ${englishOf(outcome.syncError)}`)
      // The task's row shows what the cleanup left as soon as the cleanup is over, not the folder it has just removed.
      await ctx.works.refresh(project)
      return outcome
    },
    sync: ctx.syncProject,
    refresh: async (project) => void (await ctx.refreshProject(project)),
    log: (message) => console.log(message),
    reviews: reviewDeps({
      gitlabUrls: () => gitlabUrls(ctx.profiles.current().profiles),
      git: runGit,
      repo: (project) => ctx.configStore.current.projects[project]!,
      main: ctx.branchOf,
      on: ctx.pullRequestsOn,
      token: (project, target) => ctx.ciTokenOf(project, target)?.token ?? null,
      complete: async (project, task) => {
        await ctx.linkFor(project, task)?.run(async (tracker) => tracker.complete?.(task))
      },
      // The issue is named only to show the link on GitHub: a tracker that does not answer leaves the body as it is.
      closingRef: async (project, task) =>
        (await ctx.linkFor(project, task)?.run(async (tracker) => tracker.closingRef?.(task) ?? null).catch(() => null)) ?? null,
      refusals: ctx.pullRefusals,
      now: () => new Date(),
      timeoutMs: ctx.CI_TIMEOUT_MS,
    }),
    unchanged: {
      changes: (project, workdir) => changesOf(runGit, workdir, ctx.branchOf(project)),
      complete: async (project, task, comment) => {
        const link = ctx.linkFor(project, task)
        await link?.run(async (tracker) => tracker.complete?.(task))
        // The task is done whatever becomes of the comment.
        await link?.run(async (tracker) => tracker.comment?.(task, comment)).catch((error: unknown) => {
          console.warn(`chain: ${task}: the comment on the task closed with no change did not reach the tracker: ${englishOf(noticeOf(error))}`)
        })
      },
    },
    main: mainCheckDeps({
      peers: (project) => remotePeers(ctx.remotes.view, ctx.branchOf, project),
      repo: (project) => ctx.configStore.current.projects[project]!,
      main: ctx.branchOf,
      git: runGit,
      watches: (project) => (ctx.ciWatches.found ? ctx.ciWatches.shown(project) : null),
      settings: (project) => ctx.configStore.current.settings[project]?.ci ?? DEFAULT_CI,
      commands: (project) => ctx.configStore.current.settings[project]?.check ?? [],
      language: () => ctx.configStore.current.language ?? ctx.promptLanguage(),
      promptLanguage: ctx.promptLanguage,
      create: async (task) => (await ctx.linkOf(task.project)?.run(async (tracker) => tracker.create?.(task))) ?? null,
      comment: async (task, body) => {
        const project = ctx.configuredProject(task)
        const link = project === undefined ? undefined : ctx.linkFor(project, task)
        await link?.run(async (tracker) => tracker.comment?.(task, body))
      },
      prepare: (project, task) => ctx.places.prepare(project, task),
      place: async (project, task) => (await ctx.places.readyAhead(project, task)).path,
      runCheck: (project, task, cwd) => runCheck(ctx.configStore.current.settings[project]?.check ?? [], ctx.taskRun(task, cwd, ctx.choiceFor(project, task).account)),
      afterGreen: (project) => ctx.configStore.current.settings[project]?.afterGreen ?? [],
      runAfterGreen: (project, cwd) => runAfterGreen(ctx.configStore.current.settings[project]?.afterGreen ?? [], ctx.taskRun(project, cwd, ctx.choiceFor(project).account)),
      fixName: (project) => fixNameOf(ctx.configStore.current.keys, project),
      now: () => new Date(),
    }),
  })
}

export async function checkMergeTarget(ctx: ChainContext, project: string, form: ProjectForm): Promise<void> {
  const current = ctx.configStore.current
  const records = Object.entries(current.keys).map(([id, key]) => ({ id, key }))
  const into = mergeTargetOf(records, project, form.mergeInto)
  const repo = into === null ? undefined : current.projects[into]
  if (into === null || repo === undefined || into === project) return
  const [own, target] = await Promise.all([form.repo, repo].map(async (folder) => repositoryIds(await checkoutRemotes(runGit, folder), folder)))
  if (!sameRepository(own!, target!)) throw fail('config.mergeIntoForeign', { project: projectLabel(current, project), into: projectLabel(current, into) })
}

export function wireWorks(ctx: ChainContext): TaskWorks {
  return new TaskWorks({
    read: (project) =>
      worksOf(runGit, ctx.configStore.current.projects[project]!, ctx.branchOf(project), (ctx.tasksByProject.get(project) ?? []).map((task) => task.id)),
    ttlMs: ctx.WORK_TTL_MS,
    now: () => Date.now(),
    activity: (task) => {
      const times = ctx.sessions.filter((each) => each.task === task && each.lastActivityAt !== null).map((each) => Date.parse(each.lastActivityAt!))
      return times.length === 0 ? null : Math.max(...times)
    },
    busy: (task) => ctx.agentStatus(task) === 'busy',
    onChange: () => ctx.hub.broadcast('state', ctx.getState()),
    log: (line) => console.warn(line),
  })
}

export function wireForwards(ctx: ChainContext): ForwardMerger {
  return new ForwardMerger({
    pairs: () => Object.entries(ctx.configStore.current.settings).flatMap(([from, { mergeInto: into }]) => (into === null ? [] : [{ from, into }])),
    sameRepository: ctx.sameRepositoryOf,
    repo: (project) => ctx.configStore.current.projects[project]!,
    branch: ctx.branchOf,
    label: (project) => projectLabel(ctx.configStore.current, project),
    quiet: (project) => {
      const status = (task: string) => ctx.agentStatus(task)
      return chainQuiet(ctx.dispatcher.state.active.find((chain) => chain.project === project), (task) => status(task) === 'busy' || status(task) === 'waiting')
    },
    git: runGit,
    sync: ctx.syncProject,
    now: () => new Date(),
    changed: () => ctx.hub.broadcast('state', ctx.getState()),
    log: (message) => console.log(message),
    carrying: (from) => ctx.dispatcher.carrying(from)?.task ?? null,
    auto: (from) => ctx.configStore.current.settings[from]?.carryAgent === true || ctx.configStore.current.unattended,
    resolve: async (from, ask) => {
      const config = ctx.configStore.current
      const report = PROMPTS[ctx.promptLanguage(ask.into)].carryReport({
        release: projectLabel(config, from),
        branch: ctx.branchOf(from),
        into: projectLabel(config, ask.into),
        main: ctx.branchOf(ask.into),
        ref: ask.ref,
        commit: ask.commit,
        commits: ask.commits,
        files: ask.files,
        output: ask.output,
      })
      const at = new Date().toISOString()
      ctx.dispatcher.carry(from, { task: carryNameOf(config.keys, from), into: ask.into, at, commit: ask.commit, commits: ask.commits, report })
    },
  })
}

export function resumeWith(ctx: ChainContext, task: string, session: HandoffSession, prompt: string): Promise<string> {
  return ctx.monitor.holds.during(session.sessionId, async () => {
    if (ctx.approved(task, session, prompt)) return session.sessionId
    const home = ctx.homeOf(session.account)
    const start = ctx.goOnWith(home, task, session, prompt)
    const went = session.stopped || ctx.liveView(task)?.hungSince != null ? undefined : await ctx.agentOf(home).reply?.(home, session, start)
    if (went != null) return went
    const started = Date.now()
    if (!session.stopped) await ctx.stopIn(home, session)
    const stopped = Date.now()
    await ctx.daemons.prepare(home)
    const sessionId = await ctx.resumeIn(home, session, start)
    console.log(`sessions: ${task} resumed in ${Date.now() - started} ms (stop ${stopped - started} ms)`)
    return sessionId
  }, ctx.liveView(task)?.ask?.id ?? null)
}

export function approved(ctx: ChainContext, task: string, session: HandoffSession, prompt: string): boolean {
  const ask = ctx.approvals.ask(session.sessionId)
  const move = ask === null ? null : ctx.approvals.answer(session.sessionId, prompt)
  if (move === null) return false
  if (move.kind === 'allow' && move.message !== null) {
    const { text, files } = replyParts(prompt, ask)
    ctx.mailbox.post(task, session.sessionId, text, files)
  }
  console.log(`sessions: ${task}: the user ${move.kind === 'allow' ? 'allowed' : 'denied'} the call the session ${session.sessionId} waited to have approved`)
  return true
}

export function goOnWith(ctx: ChainContext, home: AccountHome, task: string, session: HandoffSession, prompt: string): SessionStart {
  const plan = ctx.planFor(task, prompt)
  const extras = ctx.agentExtras(home, ctx.projectOf(task), task)
  return { name: task, cwd: session.cwd, prompt: plan.prompt, model: plan.model, settings: ctx.settingsFor(task), ...extras }
}

export async function steer(ctx: ChainContext, task: string, session: HandoffSession, prompt: string): Promise<boolean> {
  const home = ctx.homeOf(session.account)
  return (await ctx.agentOf(home).reply?.(home, session, ctx.goOnWith(home, task, session, prompt))) != null
}

export function occupantsOf(ctx: ChainContext, slot: string, task: string): { idle: import("../sessions/occupants.js").Occupant[]; busy: import("../sessions/occupants.js").Occupant[]; } {
  const owners = new Map(ctx.launches.map((entry) => [entry.sessionId, entry.task]))
  return slotOccupants(ctx.agents, owners, slot, task)
}

export function slotUse(ctx: ChainContext, slot: string, task: string): SlotUse {
  const { idle, busy } = ctx.occupantsOf(slot, task)
  return { idle: idle.length > 0, busy: busy.map((each) => `${each.task} (${each.agent.sessionId})`) }
}

export async function vacateSlot(ctx: ChainContext, slot: string, task: string): Promise<void> {
  const { idle, busy } = ctx.occupantsOf(slot, task)
  if (busy.length > 0) throw fail('slot.busyStart', { slot, sessions: busy.map((each) => `${each.task} (${each.agent.sessionId})`), task })
  for (const { agent, task: owner } of idle) {
    try {
      await ctx.stopIn(ctx.homeOf(agent.account ?? 'global'), { agentId: agent.id!, sessionId: agent.sessionId })
    } catch (error) {
      throw fail('slot.stopFailed', { session: agent.sessionId, owner, slot, task }, { cause: noticeOf(error) }, { cause: error })
    }
    console.log(`slot: stopped the session ${agent.sessionId} of ${owner} before ${task} took ${slot}`)
  }
}

export async function stopTaskSessions(ctx: ChainContext, repo: string, task: string, count: number): Promise<Notice[]> {
  const own = new Set(ctx.launches.filter((entry) => entry.task === task).map((entry) => entry.sessionId))
  const slots = slotPaths(repo, count)
  const idle = ctx.agents.filter(
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
      await ctx.stopIn(ctx.homeOf(agent.account ?? 'global'), { agentId: agent.id!, sessionId: agent.sessionId })
    } catch (error) {
      warnings.push(notice('cleanup.sessionNotStopped', { session: agent.sessionId }, { cause: noticeOf(error) }))
    }
  }
  return warnings
}

export function removalFacts(ctx: ChainContext, project: string, repo: string): RemovalFacts {
  const own = new Map(ctx.launches.filter((entry) => entry.project === project).map((entry) => [entry.sessionId, entry.task]))
  const slots = slotPaths(repo, ctx.configStore.current.slots[project] ?? 0)
  const sessions = ctx.agents
    .filter((agent) => isLive(agent) && (own.has(agent.sessionId) || [repo, ...slots].some((folder) => isInside(agent.cwd, folder))))
    .map((agent) => `${own.get(agent.sessionId) ?? agent.cwd} (${agent.sessionId})`)
  const { active, queue, leftovers } = ctx.dispatcher.state
  return {
    project,
    chain: active.some((chain) => chain.project === project) || queue.includes(project),
    sessions,
    held: ctx.dispatcher.held(project),
    leftovers: (leftovers[project] ?? []).map((leftover) => leftover.task),
  }
}

export function projectOf(ctx: ChainContext, task: string): string | undefined {
  for (const [project, tasks] of ctx.tasksByProject) if (tasks.some((each) => each.id === task)) return project
  const { keys, settings } = ctx.configStore.current
  const fixed = isFixName(task)
    ? projectOfFix(keys, task)
    : isCarryName(task)
      ? projectOfCarry(keys, (from) => settings[from]?.mergeInto ?? undefined, task)
      : undefined
  return fixed ?? ctx.dispatcher.state.active.find((chain) => chain.current?.task === task)?.project
}

export function slotSpan(ctx: ChainContext, project: string): number {
  const span = Math.max(ctx.slotsSeen.get(project) ?? 0, ctx.configStore.current.slots[project] ?? 0)
  ctx.slotsSeen.set(project, span)
  return span
}

export function sameRepositoryOf(ctx: ChainContext, a: string, b: string): boolean | undefined {
  const ids = ctx.remotes.repositories
  return ids[a] === undefined || ids[b] === undefined ? undefined : sameRepository(ids[a], ids[b])
}

export function wireCiWatches(ctx: ChainContext): import("../ci/watches.js").CiWatches<import("../ci/watcher.js").CiWatch> {
  return createCiWatches({
    profiles: () => ctx.profiles.current().profiles,
    git: runGit,
    token: (project, target) => ctx.ciTokenOf(project, target)?.token ?? null,
    branch: ctx.branchOf,
    timeoutMs: ctx.CI_TIMEOUT_MS,
    log: (message) => console.log(message),
    onChange: () => {
      ctx.hub.broadcast('state', ctx.getState())
      ctx.dispatcher.check()
    },
  })
}
