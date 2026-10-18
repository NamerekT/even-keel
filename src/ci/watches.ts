import type { CiSource } from './model.js'
import type { CiTarget } from './remote.js'

/** What `CiWatches` needs of a watch. */
export interface Watch {
  /** Not shown and not judging a main: no token reaches the CI (`CiWatch.hidden`). */
  readonly hidden: boolean
  setSource(source: CiSource | null): void
  tick(): Promise<void>
}

export interface CiWatchesDeps<W extends Watch> {
  /** The CIs of the repository's remotes. */
  targets: (repo: string) => Promise<CiTarget[]>
  watch: (project: string, repo: string, target: CiTarget) => W
  /** The source by the token the project's CI gets now (`ciToken`); `null` without one. */
  source: (project: string, target: CiTarget) => CiSource | null
  log: (message: string) => void
}

/** The CIs of every project, in line with the config on the fly: a project added gets its watches, one removed loses them. */
export class CiWatches<W extends Watch> {
  readonly byProject = new Map<string, W[]>()
  /** Every project of the last config is read; until then the chain does not judge a main by its CI. */
  found = false
  private readonly repos = new Map<string, string>()
  private readonly targets = new Map<W, { project: string; target: CiTarget }>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly deps: CiWatchesDeps<W>) {}

  /** Runs after the previous apply: each sees the projects as they were left by the one before. */
  apply(projects: Readonly<Record<string, string>>): Promise<void> {
    this.found = false
    this.queue = this.queue.then(() => this.reconcile({ ...projects }))
    return this.queue
  }

  /** The tokens or the profiles changed: every watch gets the source its project's token gives now. */
  tokensChanged(): void {
    for (const [watch, { project, target }] of this.targets) watch.setSource(this.deps.source(project, target))
  }

  all(): W[] {
    return [...this.byProject.values()].flat()
  }

  /** The project's watches the page shows and the chain judges its main by. */
  shown(project: string): W[] {
    return (this.byProject.get(project) ?? []).filter((watch) => !watch.hidden)
  }

  /** The CIs not shown (`hidden`: `true`) or those shown, each with its project. */
  places(hidden: boolean): { project: string; target: CiTarget }[] {
    return [...this.targets].flatMap(([watch, place]) => (watch.hidden === hidden ? [place] : []))
  }

  private async reconcile(projects: Record<string, string>): Promise<void> {
    for (const [project, repo] of this.repos) {
      if (projects[project] === repo) continue
      for (const watch of this.byProject.get(project) ?? []) this.targets.delete(watch)
      this.byProject.delete(project)
      this.repos.delete(project)
    }
    for (const [project, repo] of Object.entries(projects)) {
      if (this.repos.has(project)) continue
      this.repos.set(project, repo)
      let targets: CiTarget[]
      try {
        targets = await this.deps.targets(repo)
      } catch (error) {
        this.deps.log(`ci: the remotes of ${project} are not read: ${(error as Error).message}`)
        continue
      }
      if (targets.length === 0) continue
      const watches = targets.map((target) => {
        const watch = this.deps.watch(project, repo, target)
        this.targets.set(watch, { project, target })
        return watch
      })
      this.byProject.set(project, watches)
      this.deps.log(`ci: ${project} watches ${targets.map((target) => `${target.kind} on ${target.remote}`).join(', ')}`)
      for (const watch of watches) void watch.tick()
    }
    this.found = true
  }
}
