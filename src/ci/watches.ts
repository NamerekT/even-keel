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

  /**
   * Rereads the remotes and workflows of every project's checkout (BTN-191): a remote added or a first workflow
   * gets its watch, a CI gone loses it, an unchanged one keeps its watch. `found` stays as it is.
   * Resolves `true` when any project's watches changed.
   */
  async refresh(): Promise<boolean> {
    let changed = false
    this.queue = this.queue.then(async () => {
      for (const [project, repo] of [...this.repos]) {
        let targets: CiTarget[]
        try {
          targets = await this.deps.targets(repo)
        } catch {
          continue
        }
        if (this.repos.get(project) === repo && this.watch(project, repo, targets)) changed = true
      }
    })
    await this.queue
    return changed
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
      this.watch(project, repo, targets)
    }
    this.found = true
  }

  /** Brings the project's watches to the targets: a watch whose target stays is kept, the rest are made anew or dropped. */
  private watch(project: string, repo: string, targets: CiTarget[]): boolean {
    const before = this.byProject.get(project) ?? []
    const keyOf = (target: CiTarget) => JSON.stringify([target.kind, target.remote, target.web, target.owner, target.repo])
    const old = new Map(before.map((watch) => [keyOf(this.targets.get(watch)!.target), watch]))
    if (old.size === targets.length && targets.every((target) => old.has(keyOf(target)))) return false
    for (const watch of before) this.targets.delete(watch)
    const made: W[] = []
    const watches = targets.map((target) => {
      const kept = old.get(keyOf(target))
      if (kept !== undefined) {
        this.targets.set(kept, { project, target })
        return kept
      }
      const watch = this.deps.watch(project, repo, target)
      this.targets.set(watch, { project, target })
      made.push(watch)
      return watch
    })
    if (watches.length === 0) this.byProject.delete(project)
    else this.byProject.set(project, watches)
    if (targets.length > 0) this.deps.log(`ci: ${project} watches ${targets.map((target) => `${target.kind} on ${target.remote}`).join(', ')}`)
    else if (before.length > 0) this.deps.log(`ci: ${project} watches no CI`)
    for (const watch of made) void watch.tick()
    return true
  }
}
