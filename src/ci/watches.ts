import type { CiSource } from './model.js'
import type { CiTarget } from './remote.js'

/** What `CiWatches` needs of a watch. */
export interface Watch {
  setSource(source: CiSource | null): void
  tick(): Promise<void>
}

export interface CiWatchesDeps<W extends Watch> {
  /** The CIs of the repository's remotes. */
  targets: (repo: string) => Promise<CiTarget[]>
  watch: (project: string, repo: string, target: CiTarget) => W
  /** The source by the token the environment has now; `null` without it. */
  source: (target: CiTarget) => CiSource | null
  log: (message: string) => void
}

/** The CIs of every project, in line with the config on the fly: a project added gets its watches, one removed loses them. */
export class CiWatches<W extends Watch> {
  readonly byProject = new Map<string, W[]>()
  /** Every project of the last config is read; until then the chain does not judge a main by its CI. */
  found = false
  private readonly repos = new Map<string, string>()
  private readonly targets = new Map<W, CiTarget>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly deps: CiWatchesDeps<W>) {}

  /** Runs after the previous apply: each sees the projects as they were left by the one before. */
  apply(projects: Readonly<Record<string, string>>): Promise<void> {
    this.found = false
    this.queue = this.queue.then(() => this.reconcile({ ...projects }))
    return this.queue
  }

  /** The tokens changed: every watch gets the source the environment gives now. */
  tokensChanged(): void {
    for (const [watch, target] of this.targets) watch.setSource(this.deps.source(target))
  }

  all(): W[] {
    return [...this.byProject.values()].flat()
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
        this.targets.set(watch, target)
        return watch
      })
      this.byProject.set(project, watches)
      this.deps.log(`ci: ${project} watches ${targets.map((target) => `${target.kind} on ${target.remote}`).join(', ')}`)
      for (const watch of watches) void watch.tick()
    }
    this.found = true
  }
}
