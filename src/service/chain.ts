import { Dispatcher, type LaunchEntry } from '../chain/dispatcher.js'
import { carryNameOf, fixNameOf, isCarryName, isFixName, isOwnName, projectOfCarry, projectOfFix } from '../chain/fix.js'
import { chainQuiet, ForwardMerger } from '../chain/forward.js'
import { hubMainDeps } from '../chain/mainci.js'
import { PROMPTS } from '../chain/prompts.js'
import { loadChainState, saveChainState, saveClosedTask } from '../chain/store.js'
import { gitlabUrls } from '../ci/adapters.js'
import { createCiWatches } from '../ci/wiring.js'
import { DEFAULT_BRANCH, DEFAULT_CI, isPlain, mergeTargetOf, projectLabel, readerIds } from '../config.js'
import { runGit } from '../git/run.js'
import { slotPaths } from '../git/slot.js'
import type { MachinePort } from '../machine/port.js'
import { fail, notice } from '../notice/notice.js'
import { isInside } from '../paths.js'
import { profileFor } from '../profiles/model.js'
import { BranchControl } from '../projects/branch-control.js'
import { checkoutRemotes, remotePeers, repositoryIds, sameRepository } from '../projects/remotes.js'
import { type RemovalFacts } from '../projects/removal.js'
import { reviewDeps } from '../review/wiring.js'
import type { ServiceContext } from '../service.js'
import { isLive } from '../sessions/agents.js'
import type { ProjectForm } from '../state.js'
import { readFresh } from '../tracker/health.js'
import { issueLink } from '../tracker/model.js'
import { disabledBlock } from './accounts.js'
import { midTurn } from './cleanup.js'
import { wireClosing } from './closing.js'
export { wireBriefed, wireChangelogs, wireWithProject } from './chain-prompts.js'
export { deferLeftFolder, STOP_RETRY_MS, stopLingering, stopTaskSessions } from './cleanup.js'
export { approved, goOnWith, occupantsOf, resumeWith, slotSpan, slotUse, steer, syncProject, taskRun, vacateSlot, wireKeepWarm, wireMachine, wirePlaces, wireWorks } from './machine-chain.js'

export type ChainContext = Pick<ServiceContext,
  | 'CHANGELOG_TIMEOUT_MS'
  | 'CI_TIMEOUT_MS'
  | 'WORK_TTL_MS'
  | 'account'
  | 'accountNow'
  | 'agentExtras'
  | 'envFile'
  | 'gitFound'
  | 'agentOf'
  | 'agentStatus'
  | 'agents'
  | 'agentsRead'
  | 'approvals'
  | 'approved'
  | 'archive'
  | 'archiveClosed'
  | 'branchOf'
  | 'briefOn'
  | 'briefed'
  | 'checkReports'
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
  | 'eventLog'
  | 'envOf'
  | 'getState'
  | 'goOnWith'
  | 'homeOf'
  | 'homes'
  | 'hub'
  | 'keepWarm'
  | 'launchIn'
  | 'launches'
  | 'lingering'
  | 'ledger'
  | 'limits'
  | 'linkFor'
  | 'linkOf'
  | 'liveView'
  | 'mailbox'
  | 'machineLink'
  | 'models'
  | 'monitor'
  | 'noAccountFor'
  | 'occupantsOf'
  | 'owners'
  | 'packages'
  | 'pendingCloses'
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
  | 'readerMoves'
  | 'readerRules'
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
  | 'statusMover'
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

export async function wireDispatcher(ctx: ChainContext, machine: MachinePort): Promise<Dispatcher> {
  const closing = wireClosing(ctx)
  return new Dispatcher(await loadChainState(ctx.db), {
    machine,
    archiveClosed: ctx.archiveClosed,
    projects: () => Object.keys(ctx.configStore.current.projects),
    parallel: () => ctx.configStore.current.parallel,
    rules: ctx.rulesOf,
    fillsMilestone: (project) => ctx.configStore.current.settings[project]?.fillMilestone ?? false,
    milestoneOrder: (project) => ctx.configStore.current.settings[project]?.milestoneOrder ?? [],
    blocked: (project, task) => {
      const reason = ctx.profileBlock(project) ?? ctx.pullBlock(project)
      if (reason !== undefined || task === undefined) return reason
      return machine.launchBlock(project, task)
    },
    save: (state) => {
      ctx.writes.add('the chain state', saveChainState(ctx.db, state))
      ctx.hub.broadcastSoon('state', ctx.getState)
    },
    journal: (launched) => {
      const entry = ctx.withSource(launched)
      ctx.writes.add(`the launch of ${entry.task}`, ctx.machineLink.records.launch(entry))
    },
    moveStatus: (project, task, when) => ctx.statusMover.move(project, task, when),
    now: () => new Date(),
    trackerBlock: (project) => {
      const server = machine.trackerMissing(project)
      return server === undefined ? undefined : notice('chain.noTrackerMcp', { project: projectLabel(ctx.configStore.current, project), server })
    },
    listBlock: (project) => {
      const off = disabledBlock(ctx, project)
      if (off !== undefined) return off
      const views = ctx.trackers.views()
      for (const reader of readerIds(ctx.configStore.current, project)) {
        const view = views.find((each) => each.projects.includes(reader))
        // A tracker that is off has no list to go stale: Start says why it is empty.
        if (view === undefined || view.health.state === 'off' || readFresh(view, reader)) continue
        return notice('chain.unread', { project: projectLabel(ctx.configStore.current, project), tracker: view.title })
      }
      return undefined
    },
    promptLanguage: (task) => ctx.promptLanguage(ctx.projectOf(task)),
    mainBranch: (task) => {
      const project = ctx.projectOf(task)
      return project === undefined ? DEFAULT_BRANCH : ctx.branchOf(project)
    },
    pullRequests: (task) => {
      const project = ctx.projectOf(task)
      return project !== undefined && ctx.pullRequestsOn(project)
    },
    plain: (task) => {
      const project = ctx.projectOf(task)
      return project !== undefined && isPlain(ctx.configStore.current, project)
    },
    refresh: async (project) => void (await ctx.refreshProject(project)),
    log: (message) => console.log(message),
    reviews: reviewDeps({
      gitlabUrls: () => gitlabUrls(ctx.profiles.current().profiles),
      git: runGit,
      repo: (project) => ctx.configStore.current.projects[project]!,
      main: ctx.branchOf,
      on: ctx.pullRequestsOn,
      token: (project, target) => ctx.ciTokenOf(project, target)?.token ?? null,
      complete: closing.review,
      // The issue is named only to show the link on GitHub: a tracker that does not answer leaves the body as it is.
      closingRef: async (project, task) =>
        (await ctx.linkFor(project, task)?.run(async (tracker) => tracker.closingRef?.(task) ?? null).catch(() => null)) ?? null,
      refusals: ctx.pullRefusals,
      now: () => new Date(),
      timeoutMs: ctx.CI_TIMEOUT_MS,
    }),
    unchanged: {
      complete: closing.unchanged,
      accept: closing.accept,
    },
    main: hubMainDeps({
      projects: () => Object.keys(ctx.configStore.current.projects),
      peers: (project) => remotePeers(ctx.remotes.view, ctx.branchOf, project),
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
      afterGreen: (project) => ctx.configStore.current.settings[project]?.afterGreen ?? [],
      fixName: (project) => fixNameOf(ctx.configStore.current.keys, project),
      event: (draft) => ctx.eventLog.add(draft),
      now: () => new Date(),
    }, machine),
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

export function wireForwards(ctx: ChainContext): ForwardMerger {
  return new ForwardMerger({
    pairs: () => Object.entries(ctx.configStore.current.settings).flatMap(([from, { mergeInto: into }]) => (into === null ? [] : [{ from, into }])),
    sameRepository: ctx.sameRepositoryOf,
    repo: (project) => ctx.configStore.current.projects[project]!,
    branch: ctx.branchOf,
    label: (project) => projectLabel(ctx.configStore.current, project),
    quiet: (project) => {
      if (!ctx.agentsRead) return false
      const status = (task: string) => ctx.agentStatus(task)
      return chainQuiet(ctx.dispatcher.state.active.find((chain) => chain.project === project), (task) => status(task) === 'busy' || status(task) === 'waiting')
    },
    git: runGit,
    sync: ctx.syncProject,
    now: () => new Date(),
    changed: () => ctx.hub.broadcastSoon('state', ctx.getState),
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

/**
 * A task of the project is in hand, or a session of its launches is mid-turn: the merge goes into the branch the task
 * started from, so the branch and the checkout hold until it ends (BTN-754).
 */
export function branchBusy(ctx: ChainContext, project: string): boolean {
  if (ctx.dispatcher.state.active.some((chain) => chain.project === project && chain.current !== null)) return true
  const own = new Set(ctx.launches.filter((entry) => entry.project === project).map((entry) => entry.sessionId))
  return ctx.agents.some((agent) => own.has(agent.sessionId) && isLive(agent) && midTurn(agent))
}

export function wireBranches(ctx: ChainContext): BranchControl {
  return new BranchControl({
    git: runGit,
    // A project without git has no checkout to stand off its branch.
    repo: (project) => (isPlain(ctx.configStore.current, project) ? undefined : ctx.configStore.current.projects[project]),
    branch: ctx.branchOf,
    key: (project) => ctx.configStore.current.keys[project] ?? project,
    busy: (project) => branchBusy(ctx, project),
    write: (project, branch) => {
      const base = ctx.configStore.view().projects[project]!
      ctx.configStore.saveProject(project, { ...base, branch }, base, profileFor(ctx.profiles.current(), project, ctx.configStore.current.trackers[project]!)?.rules)
    },
    changed: () => ctx.hub.broadcastSoon('state', ctx.getState),
  })
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
    counted: (project, kind) => (ctx.configStore.current.settings[project]?.ci ?? DEFAULT_CI).kinds.includes(kind),
    timeoutMs: ctx.CI_TIMEOUT_MS,
    log: (message) => console.log(message),
    onChange: () => {
      ctx.hub.broadcastSoon('state', ctx.getState)
      ctx.dispatcher.check()
    },
    recovered: (project, target) => {
      const profile = ctx.ciTokenOf(project, target)?.profile
      if (profile !== undefined) ctx.profiles.recheckSoon(profile)
    },
  })
}
