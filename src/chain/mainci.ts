import type { CiView } from '../ci/model.js'
import { redReport, type FailedRun } from '../ci/report.js'
import { verdictOf, type RedRun } from '../ci/verdict.js'
import type { Git } from '../git/types.js'
import type { Language } from '../language.js'
import type { CiSettings } from '../state.js'
import type { NewTask } from '../tracker/source.js'
import type { MainCheckDeps } from './model.js'

/** The commits a fix task lists, from the last green commit; without one, the latest of main. */
const COMMITS_SINCE_GREEN = 50
const COMMITS_WITHOUT_GREEN = 20

export interface MainCiWatch {
  view: CiView
  failed(run: RedRun['run']): Promise<FailedRun>
}

export interface MainCiDeps {
  repo: (project: string) => string
  git: Git
  watches: (project: string) => MainCiWatch[]
  settings: (project: string) => CiSettings
  language: () => Language
  /** `null` — the tracker cannot create tasks. */
  create: (task: NewTask) => Promise<string | null>
  comment: (task: string, body: string) => Promise<void>
  prepare: (project: string, task: string) => Promise<void>
  now: () => Date
}

// What the chain's check of main (BTN-103) needs from the service: git of the project, its counted CIs, the tracker.
export function mainCheckDeps(deps: MainCiDeps): MainCheckDeps {
  const counted = (project: string) => {
    const kinds = deps.settings(project).kinds
    return deps.watches(project).filter((watch) => kinds.includes(watch.view.kind))
  }

  return {
    async head(project) {
      const read = await deps.git(deps.repo(project), ['rev-parse', '--verify', '--quiet', 'refs/heads/main'])
      return read.code === 0 ? read.out.trim() : null
    },
    verdict: (project, commit, since) => verdictOf(counted(project).map((watch) => watch.view), commit, since, deps.now()),
    waitMs(project) {
      const minutes = deps.settings(project).waitMinutes
      return minutes === null ? null : minutes * 60_000
    },
    async report(project, push, failed, green) {
      const watches = counted(project)
      const runs = await Promise.all(
        failed.map(({ kind, run }) => watches.find((watch) => watch.view.kind === kind)?.failed(run) ?? Promise.resolve({ kind, run, jobs: null, log: null })),
      )
      const range = green === null ? [`-${COMMITS_WITHOUT_GREEN}`, push.commit] : [`-${COMMITS_SINCE_GREEN}`, `${green}..${push.commit}`]
      const log = await deps.git(deps.repo(project), ['log', '--format=%h %s', ...range])
      const commits = log.code === 0 ? log.out.split(/\r?\n/).filter((line) => line.trim() !== '') : []
      return redReport({ commit: push.commit, runs, commits, green, tasks: push.tasks }, deps.language())
    },
    create: (project, task) => deps.create({ project, ...task }),
    comment: deps.comment,
    prepare: deps.prepare,
  }
}
