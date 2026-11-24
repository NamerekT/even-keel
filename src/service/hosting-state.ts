import { headerLevels } from '../account/header-levels.js'
import type { AccountView } from '../account/model.js'
import { AGENTS } from '../agent/adapters.js'
import { outdatedDaemonView } from '../agent/versions.js'
import { archivedShown } from '../chain/archive.js'
import { archivePage } from '../chain/archive-pages.js'
import { outsideTasks } from '../chain/outside.js'
import { fallbacksSince, fixEpisodes, launchDays, taskSessions, type TaskSession } from '../chain/launches.js'
import { spentLimit } from '../chain/limitNotice.js'
import { ciViews } from '../ci/wiring.js'
import { idPrefixOf, projectLabels, readerIds, runSettings } from '../config.js'
import { DEMO_ACCOUNT } from '../demo/model.js'
import { dictationSettings } from '../dictation/transcribe.js'
import { gitSetup } from '../git/setup.js'
import { hulyClient } from '../huly/client.js'
import { stepJobs } from '../jobs/runner.js'
import type { ArchivePage, EvenKeelState, OutsideTask, SessionView, TaskHistory } from '../state.js'
import { isOpen, type Task } from '../tracker/model.js'
import { RAN_SHOWN_MS } from '../tracker/start.js'
import { runOf } from './demo.js'
import { pinnable, pinWaits } from '../machine/pins.js'
import type { HostingContext } from './hosting.js'
import { inContainer } from '../locations.js'
import { kindOf } from '../link/kinds.js'
import { recentHistory } from './page-history.js'

/** The hub's own machine as its icon shows it (BTN-1595): the hub's process knows its system and container itself. */
const OWN_KIND = kindOf({ os: process.platform, container: inContainer })

export function wireGetState(ctx: HostingContext): () => EvenKeelState {
  // The machine's sessions and accounts come from the hub's mirror (`docs/machines.md`, "The mirror"), never its objects.
  const machine = ctx.machineLink.page
  const panel = (): AccountView => ({ ...(machine.panel() ?? EMPTY_PANEL), active: ctx.activeAccount() })
  const view = (orders: ReturnType<HostingContext['dispatcher']['orders']>, accounts: AccountView): EvenKeelState => ({
    protection: ctx.protectionAudit.view,
    intakeTemplates: ctx.intakeTemplateHits,
    startedAt: ctx.startedAt,
    ...(ctx.machineLink.hubCommit !== null && { hubCommit: ctx.machineLink.hubCommit }),
    platform: process.platform,
    projects: Object.keys(ctx.configStore.current.projects),
    projectKeys: ctx.configStore.current.keys,
    projectLabels: projectLabels(ctx.configStore.current),
    taskPrefixes: Object.fromEntries(Object.keys(ctx.configStore.current.keys).map((project) => [project, idPrefixOf(ctx.configStore.current, project)])),
    demo: ctx.demo.view(),
    config: ctx.configStore.view(ctx.lockedReaders()),
    branchDrift: ctx.branches.view(),
    machineDrift: ctx.branches.machineDrift(),
    chain: {
      // The page names each lane's machine: one on the own machine gets its id too.
      active: ctx.dispatcher.state.active.map((lane) => {
        const spent = lane.current === null ? null : spentLimit({ machine: ctx.machineLink.port }, lane.project, lane.current.task)
        return { ...lane, ...(lane.machine === undefined && { machine: ctx.machineLink.machines.own() }), ...(spent !== null && { spent }) }
      }),
      parallel: ctx.configStore.current.parallel,
      queue: ctx.dispatcher.state.queue,
      projects: orders,
      skipped: ctx.dispatcher.state.skipped,
      leftovers: ctx.dispatcher.state.leftovers,
      landings: Object.fromEntries(Object.entries(ctx.dispatcher.state.landings).map(([project, landings]) => [
        project,
        landings.map(({ task, resolving, waitingRemote }) => ({ task, ...(resolving && { resolving }), ...(waitingRemote && { waitingRemote }) })),
      ])),
    },
    tasks: Object.keys(ctx.configStore.current.projects).flatMap((project) => shownTasks(ctx, project).map((task) => ({ ...task, project }))),
    archiveMore: archiveMore(ctx),
    runs: Object.fromEntries(Object.keys(ctx.configStore.current.projects).flatMap((project) => {
      const runs = ctx.runsOfProject(project)
      return Object.keys(runs).length === 0 ? [] : [[project, runs]]
    })),
    parents: Object.fromEntries(Object.keys(ctx.configStore.current.projects).flatMap((project) => {
      const parents = ctx.parentsByProject.get(project)
      return parents === undefined ? [] : [[project, parents]]
    })),
    sessions: pageSessions(ctx),
    limits: machine.limits(ctx.activeAccount()),
    usage: machine.usage(ctx.activeAccount()),
    account: {
      ...accounts,
      // The demo's account is no account of the person's: the accounts' lists and pickers never show it (BTN-776).
      accounts: accounts.accounts.filter((entry) => entry.key !== DEMO_ACCOUNT),
      headerLevels: Object.fromEntries(Object.keys(ctx.configStore.current.projects).map((project) => [project, headerLevels({
        shared: runSettings(ctx.configStore.current, undefined),
        project: runOf(ctx, project),
        runOf: (task) => ctx.runOfTask(project, task),
        tasks: ctx.tasksByProject.get(project) ?? [],
        order: orders[project]?.order ?? [],
        current: ctx.dispatcher.state.active.find((chain) => chain.project === project)?.current ?? null,
        holding: [...(ctx.dispatcher.state.skipped[project] ?? []), ...(orders[project]?.waiting ?? [])],
        sessionAccount: (sessionId) => machine.ownerOf(sessionId),
        hasAccount: (provider, key) => machine.hasAccount(provider, key),
      })])),
    },
    trackers: ctx.trackers.views().map((view) => {
      const moveFailures = Object.fromEntries(view.projects.flatMap((reader) => {
        const failures = ctx.statusMover.failures(reader)
        return failures.length === 0 ? [] : [[reader, failures]]
      }))
      return Object.keys(moveFailures).length === 0 ? view : { ...view, moveFailures }
    }),
    trackerUrls: {
      default: ctx.trackers.setupOf(null)?.issueUrl(null) ?? null,
      projects: Object.fromEntries(Object.keys(ctx.readers().projects).map((reader) => [idPrefixOf(ctx.readers(), reader), ctx.trackers.setupOf(reader)?.issueUrl(reader) ?? null])),
      pages: Object.fromEntries(Object.keys(ctx.readers().projects).map((reader) => [reader, ctx.trackers.setupOf(reader)?.projectUrl?.(reader) ?? null])),
    },
    ci: ciViews(ctx.ciWatches),
    mainCi: Object.fromEntries([...ctx.ciWatches.byProject.keys()].flatMap((project) => {
      const main = ctx.dispatcher.main?.view(project)
      return main === undefined ? [] : [[project, main]]
    })),
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
    taskSessions: allTaskSessions(ctx),
    fixes: fixEpisodes(ctx.launches).episodes,
    works: machine.works(),
    diffs: machine.diffs(),
    context: ctx.configStore.current.context,
    configError: ctx.configStore.error ?? ctx.listenError,
    packages: ctx.packages.view(),
    secrets: ctx.secrets.view(),
    profiles: ctx.profiles.view(),
    language: ctx.configStore.current.language,
    unattended: ctx.dispatcher.state.unattended,
    trimTools: ctx.dispatcher.state.trimTools,
    showTests: { home: ctx.configStore.current.homeShowTests, stats: ctx.configStore.current.statsShowTests },
    tally: ctx.tallyMode(),
    tallyHealth: ctx.tally.health(),
    dictation: dictationSettings(process.env) !== undefined,
    hulyClient: hulyClient.view(),
    updates: { ...ctx.releasesView(), ...ctx.updater.view() },
    backup: ctx.backups.view(),
    memoryMirror: ctx.memory.mirrorView(),
    noticesDismissed: ctx.dismissedNotices,
    hotkeys: ctx.browserHotkeys,
    cliVersions: [...ctx.cliVersions.view(), ...ctx.daemons.outdated().map((daemon) => outdatedDaemonView(daemon, AGENTS[daemon.agent]!.title))],
    cliCopies: Object.fromEntries(Object.entries(ctx.cliCopies.view()).map(([name, copy]) => [name, { ...copy, installed: ctx.cliVersions.installedOf(name) }])),
    cliChecks: ctx.cliChecks.view(),
    git: gitSetup.view(),
    gitFound: machine.gitFound(),
    machineSignIns: ctx.machineLink.network.signIns(),
    machineRequests: ctx.machineLink.requests.waiting(),
    machineNames: ctx.machineLink.network.names(),
    liveMachines: ctx.machineLink.network.live(),
    machineColors: ctx.machineLink.network.colors(),
    machineKinds: { ...ctx.machineLink.network.kinds(), [ctx.machineLink.machines.own()]: OWN_KIND },
    ownMachine: ctx.machineLink.machines.own(),
    stranded: ctx.machineLink.reassigner.stranded(),
    pools: Object.fromEntries(Object.keys(ctx.configStore.current.projects).map((project) => [
      project,
      pinnable(ctx.machineLink.network.poolOf(project), ctx.machineLink.network.live(), ctx.machineLink.own()),
    ])),
    pinWaits: Object.fromEntries(Object.keys(ctx.configStore.current.projects).flatMap((project) => {
      const runs = ctx.runsOfProject(project)
      const open = (ctx.tasksByProject.get(project) ?? []).filter((task) => (runs[task.id]?.machines?.length ?? 0) > 0)
      if (open.length === 0) return []
      const pins = Object.fromEntries(open.map((task) => [task.id, runs[task.id]!.machines!]))
      const waits = pinWaits(project, pins, ctx.dispatcher.state, ctx.machineLink.machines)
      return Object.keys(waits).length === 0 ? [] : [[project, waits]]
    })),
    jobs: stepJobs.view(),
    fallbacks: fallbacksSince(ctx.launches, new Date(Date.now() - ctx.FALLBACK_TOAST_MS)).map(({ at, task, project, fallback }) => ({
      at,
      task,
      notice: ctx.noAccountFor(task, fallback, runSettings(ctx.configStore.current, project).provider),
    })),
    mailbox: ctx.machineLink.sessions.mailbox(),
    changelogs: ctx.changelogs.writtenTasks(),
    forwards: ctx.forwards.view(),
    eventLog: [...ctx.eventLog.entries],
  })
  return () => {
    const state = view(ctx.dispatcher.orders(), panel())
    const current = ctx.dispatcher.state.active.flatMap((chain) => (typeof chain.current?.sessionId === 'string' ? [chain.current.sessionId] : []))
    const recent = recentHistory({ ...state, current }, new Date())
    return { ...state, ...recent }
  }
}

/** The project's tasks the page gets: those its readers read, and the archive's lately closed ones they no longer give. */
function shownTasks(ctx: HostingContext, project: string): Task[] {
  const listed = ctx.tasksByProject.get(project) ?? []
  return [...listed, ...archivedShown(ctx.archive, project, listed, new Date(Date.now() - RAN_SHOWN_MS))]
}

/** `EvenKeelState.archiveMore` (BTN-1445): the closed tasks the readers' trackers count, less the closed ones shown. */
function archiveMore(ctx: HostingContext): Record<string, number> {
  const views = ctx.trackers.views()
  return Object.fromEntries(Object.keys(ctx.configStore.current.projects).flatMap((project) => {
    const counts = readerIds(ctx.configStore.current, project).flatMap((reader) => views.find((view) => view.projects.includes(reader))?.closedTotal?.[reader] ?? [])
    if (counts.length === 0) return []
    const shown = shownTasks(ctx, project).filter((task) => !isOpen(task.status)).length
    return [[project, Math.max(0, counts.reduce((sum, count) => sum + count, 0) - shown)]]
  }))
}

/** `archive/page`: a page of the project's closed tasks beyond those in the state (BTN-1445). */
export function archiveOf(ctx: HostingContext, project: string, after: string | null, focus?: string): Promise<ArchivePage> {
  return archivePage(
    {
      readers: (id) => readerIds(ctx.configStore.current, id),
      linkOf: ctx.linkOf,
      rulesOf: ctx.readerRules,
      shown: (id) => new Set(shownTasks(ctx, id).map((task) => task.id)),
    },
    project,
    after,
    focus,
  )
}

/** `outside/tasks`: the project's open tasks the rules keep out of both the chain and the backlog (BTN-1428). */
export function outsideOf(ctx: HostingContext, project: string): Promise<OutsideTask[]> {
  return outsideTasks(
    {
      readers: (id) => readerIds(ctx.configStore.current, id),
      linkOf: ctx.linkOf,
      rulesOf: ctx.readerRules,
      milestoneOrder: (id) => ctx.configStore.current.settings[id]?.milestoneOrder ?? [],
    },
    project,
  )
}

// A finished session's feed is read from its record, and the page shows no action of it (`showsAction`); the one the
// chain waits on keeps both: delivering an answer stops it for a while, and the page shows it working (BTN-695).
// Every machine's sessions: a task a machine elsewhere runs leaves its start and shows its lamp as the hub's (BTN-1314).
function pageSessions(ctx: HostingContext): SessionView[] {
  return ctx.machineLink.sessions.sessions().map((view) =>
    view.lamp === 'finished' && !ctx.dispatcher.state.active.some((chain) => chain.current?.sessionId === view.sessionId) ? { ...view, feed: [], action: null } : view,
  )
}

function allTaskSessions(ctx: HostingContext): Record<string, TaskSession[]> {
  const machine = ctx.machineLink.sessions
  return taskSessions(
    ctx.launches,
    machine.sessions(),
    (sessionId, at) => machine.sessionAccount(sessionId, at),
    (sessionId) => machine.compactionsOf(sessionId),
    (sessionId) => machine.sessionAgent(sessionId),
  )
}

/** `history/task`: every run of the task and every session of it or of its runs (BTN-1256). */
export function taskHistory(ctx: HostingContext, task: string): TaskHistory {
  const runs = allTaskSessions(ctx)[task] ?? []
  const ids = new Set(runs.map((run) => run.sessionId))
  return { runs, sessions: pageSessions(ctx).filter((view) => view.task === task || ids.has(view.sessionId)) }
}

/** The accounts panel before the machine's first snapshot. */
const EMPTY_PANEL: AccountView = { active: '', accounts: [], login: null, loginBlock: null, apps: [], pool: [], missing: [] }
