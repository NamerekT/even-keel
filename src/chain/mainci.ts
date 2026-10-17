import type { CiView } from '../ci/model.js'
import { redReport, type FailedRun } from '../ci/report.js'
import { shortCommit, verdictOf, type RedRun } from '../ci/verdict.js'
import { branchMerged } from '../git/merged.js'
import type { Git } from '../git/types.js'
import type { Language } from '../language.js'
import type { CiSettings } from '../state.js'
import type { NewTask } from '../tracker/source.js'
import type { CheckFailure, MainCheckDeps } from './model.js'

/** The commits a fix task lists, from the last green commit; without one, the latest of main. */
const COMMITS_SINCE_GREEN = 50
const COMMITS_WITHOUT_GREEN = 20

export interface MainCiWatch {
  view: CiView
  failed(run: RedRun['run']): Promise<FailedRun>
}

export interface MainCiDeps {
  repo: (project: string) => string
  /** The project's main branch. */
  main: (project: string) => string
  git: Git
  /** `null` — the service has yet to find the project's CIs. */
  watches: (project: string) => MainCiWatch[] | null
  settings: (project: string) => CiSettings
  /** The project's check commands (`commands.check`). */
  commands: (project: string) => string[]
  language: () => Language
  promptLanguage: () => Language
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
export function mainCheckDeps(deps: MainCiDeps): MainCheckDeps {
  const counted = (project: string): MainCiWatch[] | null => {
    const { guard, kinds } = deps.settings(project)
    return guard ? (deps.watches(project)?.filter((watch) => kinds.includes(watch.view.kind)) ?? null) : []
  }
  const revision = async (cwd: string, rev: string) => {
    const read = await deps.git(cwd, ['rev-parse', '--verify', '--quiet', rev])
    return read.code === 0 ? read.out.trim() : null
  }

  return {
    head: (project) => revision(deps.repo(project), `refs/heads/${deps.main(project)}`),
    verdict(project, commit, since) {
      // Right after a start the CIs are not found yet: without the wait an awaited push would pass for one without a CI.
      const watches = counted(project)
      return watches === null ? { state: 'pending' } : verdictOf(watches.map((watch) => watch.view), commit, since, deps.now())
    },
    waitMs(project) {
      const minutes = deps.settings(project).waitMinutes
      return minutes === null ? null : minutes * 60_000
    },
    async report(project, push, failure, green) {
      const range = green === null ? [`-${COMMITS_WITHOUT_GREEN}`, push.commit] : [`-${COMMITS_SINCE_GREEN}`, `${green}..${push.commit}`]
      const log = await deps.git(deps.repo(project), ['log', '--format=%h %s', ...range])
      const commits = log.code === 0 ? log.out.split(/\r?\n/).filter((line) => line.trim() !== '') : []
      const facts = { commit: push.commit, commits, green, tasks: push.tasks }
      if ('check' in failure) return redReport({ ...facts, runs: [], check: failure.check }, deps.language(), deps.promptLanguage())
      const watches = counted(project) ?? []
      const runs = await Promise.all(
        failure.ci.map(({ kind, run }) => watches.find((watch) => watch.view.kind === kind)?.failed(run) ?? Promise.resolve({ kind, run, jobs: null, log: null })),
      )
      return redReport({ ...facts, runs }, deps.language(), deps.promptLanguage())
    },
    create: (project, task) => deps.create({ project, ...task }),
    comment: deps.comment,
    prepare: deps.prepare,
    async taskTree(project, task) {
      const repo = deps.repo(project)
      const refs = await deps.git(repo, ['for-each-ref', '--format=%(objectname)', `refs/heads/${task.toLowerCase()}`])
      const commit = refs.code === 0 ? refs.out.split(/\r?\n/).find((line) => line.trim() !== '') : undefined
      return commit === undefined ? null : revision(repo, `${commit.trim()}^{tree}`)
    },
    tree: (project, commit) => revision(deps.repo(project), `${commit}^{tree}`),
    checking(project) {
      const { guard, recheckMain } = deps.settings(project)
      return { commands: guard ? deps.commands(project) : [], recheck: recheckMain }
    },
    async checkMain(project, task) {
      // A check of main due from before the guard was turned off.
      if (!deps.settings(project).guard) return { state: 'skipped', reason: 'the guard of main is off' }
      const path = await deps.place(project, task)
      const branch = deps.main(project)
      const [head, main] = await Promise.all([revision(path, 'HEAD'), revision(deps.repo(project), `refs/heads/${branch}`)])
      if (head === null || head !== main) return { state: 'skipped', reason: `the place of ${task} (${path}) is not on ${branch}` }
      const failure = await deps.runCheck(project, task, path)
      return failure === null ? { state: 'green' } : { state: 'red', failure }
    },
    fixTask: (project) => deps.settings(project).fixTask,
    merged: (project, task) => branchMerged(deps.git, deps.repo(project), task, deps.main(project)),
    afterGreen: (project) => deps.settings(project).guard && deps.afterGreen(project).length > 0,
    // The only place the dispatcher touches the project's own checkout, so only when it stands on main at the green commit.
    async runAfterGreen(project, commit) {
      const repo = deps.repo(project)
      const branch = deps.main(project)
      const [on, head] = await Promise.all([deps.git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']), revision(repo, 'HEAD')])
      const current = on.code === 0 ? on.out.trim() : null
      if (current !== branch) return { state: 'skipped', reason: `the checkout ${repo} is on ${current ?? 'no branch'}, not on ${branch}` }
      if (head !== commit) return { state: 'skipped', reason: `the checkout ${repo} is at ${shortCommit(head ?? 'nothing')}, past the green commit` }
      const failure = await deps.runAfterGreen(project, repo)
      return failure === null ? { state: 'done' } : { state: 'failed', failure }
    },
  }
}
