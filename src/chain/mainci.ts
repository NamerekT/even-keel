import type { CiView } from '../ci/model.js'
import { redReport, type FailedRun } from '../ci/report.js'
import { CI_TITLES, verdictOf, type RedRun } from '../ci/verdict.js'
import type { EventDraft } from '../event-log/model.js'
import type { ForwardOutcome } from '../git/sync.js'
import type { Git } from '../git/types.js'
import type { Language } from '../language.js'
import { mainMachineDeps } from '../machine/main.js'
import type { MachineMainPort } from '../machine/port.js'
import { fail } from '../notice/notice.js'
import type { CiSettings } from '../state.js'
import type { NewTask } from '../tracker/source.js'
import type { CheckReport } from './checkreports.js'
import type { CheckFailure, MainCheckDeps } from './model.js'

export interface MainCiWatch {
  view: CiView
  /** The remote's main as the watch last read it; `null` — not yet. */
  readonly remoteHead: string | null
  failed(run: RedRun['run']): Promise<FailedRun>
  /** Polls the CI's finished history for a while, for a fresh verdict on a commit (`CiWatch.want`). */
  want(): void
  /** Whether the CI's adapter can rerun failed jobs (`CiSource.rerun`). */
  readonly rerunnable: boolean
  /** Reruns the run's failed jobs (`CiWatch.rerun`); throws `ci.rerunUnsupported` for a CI without a rerun. */
  rerun(run: RedRun['run']): Promise<void>
}

export interface MainCiDeps {
  projects: () => string[]
  /** The other projects whose checkout has a remote in common with this one's and the same main branch. */
  peers: (project: string) => string[]
  repo: (project: string) => string
  /** A project without git (BTN-883): no git runs in its folder, so its main has no commit, tree or merged branch. */
  plain?: (project: string) => boolean
  /** The project's main branch. */
  main: (project: string) => string
  git: Git
  /** `null` — the service has yet to find the project's CIs. */
  watches: (project: string) => MainCiWatch[] | null
  settings: (project: string) => CiSettings
  /** The project's check commands (`commands.check`). */
  commands: (project: string) => string[]
  /** What the check before the task's merge reported (`CheckReports`). */
  reported: (project: string, task: string) => CheckReport | undefined
  language: () => Language
  promptLanguage: (project: string) => Language
  /** `null` — the tracker cannot create tasks. */
  create: (task: NewTask) => Promise<string | null>
  comment: (task: string, body: string) => Promise<void>
  prepare: (project: string, task: string) => Promise<void>
  /** The task's worktree or slot made ready for its launch; the launch then reuses it. */
  place: (project: string, task: string) => Promise<string>
  /** Runs the project's check commands in a folder; `null` — all passed. */
  runCheck: (project: string, task: string, cwd: string) => Promise<CheckFailure | null>
  /** The project's commands after a green main (`commands.afterGreen`). */
  afterGreen: (project: string) => string[]
  /** Runs them in a folder; `null` — all passed. */
  runAfterGreen: (project: string, cwd: string) => Promise<CheckFailure | null>
  /** Main went green at a commit (`MainCheckDeps.green`). */
  green?: (project: string, commit: string) => void
  /** Brings a machine elsewhere's main up to the green commit by fast-forward, where it can (BTN-994). */
  forward?: (project: string, commit: string) => Promise<ForwardOutcome>
  /** The name the project's fix session runs under (`fixNameOf`). */
  fixName: (project: string) => string
  /** Writes an entry of the event log. */
  event: (draft: EventDraft) => void
  now: () => Date
}

/** The check a session runs before it merges (BTN-104): only when no counted CI is there to judge main, and never with the guard off. */
export function mergeCheck(commands: string[], settings: CiSettings, views: CiView[]): string[] {
  if (!settings.guard) return []
  const counted = views.filter((view) => settings.kinds.includes(view.kind))
  return counted.length > 0 && counted.every((view) => view.health === 'ok') ? [] : commands
}

// What the chain's check of main (BTN-103, BTN-104) needs from the service: git of the project, its counted CIs,
// its own check and the tracker. With the guard of main off no CI counts and there is no check, so a push is never awaited.
export function hubMainDeps(deps: Pick<MainCiDeps, 'projects' | 'peers' | 'watches' | 'settings' | 'commands' | 'language' | 'promptLanguage' | 'create' | 'comment' | 'afterGreen' | 'green' | 'fixName' | 'event' | 'now'>, machine: Pick<MachineMainPort, 'history'>): MainCheckDeps {
  const counted = (project: string): MainCiWatch[] | null => {
    const { guard, kinds } = deps.settings(project)
    return guard ? (deps.watches(project)?.filter((watch) => kinds.includes(watch.view.kind)) ?? null) : []
  }

  return {
    // A project with the guard off neither holds nor is held by the others.
    peers: (project) => (deps.settings(project).guard ? deps.peers(project).filter((peer) => deps.settings(peer).guard) : []),
    verdict(project, commit, since) {
      // Right after a start the CIs are not found yet: without the wait an awaited push would pass for one without a CI.
      const watches = counted(project)
      if (watches === null) return { state: 'pending' }
      // Every CI the service watches, counted or not: a run of any project on a shared runner keeps it busy.
      const neighbours = deps.projects().flatMap((other) => deps.watches(other)?.map((watch) => watch.view) ?? [])
      return verdictOf(watches.map((watch) => watch.view), commit, since, deps.now(), neighbours)
    },
    lookAgain(project) {
      for (const watch of counted(project) ?? []) watch.want()
    },
    rerunFailed: (project) => {
      const { guard, rerunFailed } = deps.settings(project)
      return guard && rerunFailed
    },
    async rerun(project, failed) {
      const watches = counted(project) ?? []
      const runs = failed.map(({ kind, run }) => ({ kind, run, watch: watches.find((each) => each.view.kind === kind) }))
      // A CI that cannot rerun leaves the red to decide at once: none is started then.
      const unable = runs.find(({ watch }) => watch?.rerunnable !== true)
      if (unable !== undefined) throw fail('ci.rerunUnsupported', { ci: CI_TITLES[unable.kind] })
      for (const { run, watch } of runs) await watch!.rerun(run)
    },
    event: deps.event,
    remoteHeads() {
      const heads: Record<string, string> = {}
      for (const project of deps.projects()) {
        const seen = new Set((counted(project) ?? []).map((watch) => watch.remoteHead))
        const [head] = seen
        if (seen.size === 1 && head !== null && head !== undefined) heads[project] = head
      }
      return heads
    },
    waitMs(project) {
      const minutes = deps.settings(project).waitMinutes
      return minutes === null ? null : minutes * 60_000
    },
    async report(project, push, failure, candidates) {
      const { commits, greens } = await machine.history(project, push.commit, candidates)
      const facts = { commit: push.commit, commits, greens, tasks: push.tasks }
      if ('check' in failure) return redReport({ ...facts, runs: [], check: failure.check }, deps.language(), deps.promptLanguage(project))
      const watches = counted(project) ?? []
      const runs = await Promise.all(
        failure.ci.map(({ kind, run }) => watches.find((watch) => watch.view.kind === kind)?.failed(run) ?? Promise.resolve({ kind, run, jobs: null, log: null })),
      )
      return redReport({ ...facts, runs, reran: failure.reran === true }, deps.language(), deps.promptLanguage(project))
    },
    create: (project, task) => deps.create({ project, ...task }),
    comment: deps.comment,
    checking(project) {
      const { guard, recheckMain } = deps.settings(project)
      return { commands: guard ? deps.commands(project) : [], recheck: recheckMain }
    },
    fixTask: (project) => deps.settings(project).fixTask,
    fixName: deps.fixName,
    afterGreen: (project) => deps.settings(project).guard && deps.afterGreen(project).length > 0,
    ...(deps.green !== undefined && { green: deps.green }),
  }
}

/** Combined assembly for callers testing the two sides together; production wires each side separately. */
export function mainCheckDeps(deps: MainCiDeps): MainCheckDeps & MachineMainPort {
  const machine = mainMachineDeps(deps)
  return { ...hubMainDeps(deps, machine), ...machine }
}
