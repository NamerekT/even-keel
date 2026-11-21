import { headerLevels } from '../account/header-levels.js'
import type { AccountView } from '../account/model.js'
import { AGENTS } from '../agent/adapters.js'
import { outdatedDaemonView } from '../agent/versions.js'
import { archivedShown } from '../chain/archive.js'
import { fallbacksSince, fixEpisodes, launchDays, taskSessions, type TaskSession } from '../chain/launches.js'
import { spentLimit } from '../chain/limitNotice.js'
import { ciViews } from '../ci/wiring.js'
import { idPrefixOf, projectLabels, runSettings } from '../config.js'
import { DEMO_ACCOUNT } from '../demo/model.js'
import { dictationSettings } from '../dictation/transcribe.js'
import { gitSetup } from '../git/setup.js'
import { hulyClient } from '../huly/client.js'
import { stepJobs } from '../jobs/runner.js'
import type { EvenKeelState, SessionView, TaskHistory } from '../state.js'
import { RAN_SHOWN_MS } from '../tracker/start.js'
import { runOf } from './demo.js'
import type { HostingContext } from './hosting.js'
import { recentHistory } from './page-history.js'

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
    },
    tasks: Object.keys(ctx.configStore.current.projects).flatMap((project) => {
      const listed = ctx.tasksByProject.get(project) ?? []
      const archived = archivedShown(ctx.archive, project, listed, new Date(Date.now() - RAN_SHOWN_MS))
      return [...listed, ...archived].map((task) => ({ ...task, project }))
    }),
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
    noticesDismissed: ctx.dismissedNotices,
    hotkeys: ctx.browserHotkeys,
    cliVersions: [...ctx.cliVersions.view(), ...ctx.daemons.outdated().map((daemon) => outdatedDaemonView(daemon, AGENTS[daemon.agent]!.title))],
    cliCopies: Object.fromEntries(Object.entries(ctx.cliCopies.view()).map(([name, copy]) => [name, { ...copy, installed: ctx.cliVersions.installedOf(name) }])),
    cliChecks: ctx.cliChecks.view(),
    git: gitSetup.view(),
    gitFound: machine.gitFound(),
    machineSignIns: ctx.machineLink.network.signIns(),
    machineNames: ctx.machineLink.network.names(),
    machineColors: ctx.machineLink.network.colors(),
    ownMachine: ctx.machineLink.machines.own(),
    stranded: ctx.machineLink.reassigner.stranded(),
    jobs: stepJobs.view(),
    fallbacks: fallbacksSince(ctx.launches, new Date(Date.now() - ctx.FALLBACK_TOAST_MS)).map(({ at, task, project, fallback }) => ({
      at,
      task,
      notice: ctx.noAccountFor(task, fallback, runSettings(ctx.configStore.current, project).provider),
    })),
    mailbox: machine.mailbox(),
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
