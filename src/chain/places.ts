import { catchUp } from '../git/worktree.js'
import type { Git, TaskPlace } from '../git/types.js'

export interface PlaceOptions {
  /** Made before the launch: a task without a branch gets it only at the launch, where a tracker's git hook starts it. */
  ahead?: boolean
  /** The place made ahead for the task, so the launch takes the same slot. */
  at?: string
}

export interface TaskPlacesDeps {
  git: Git
  /** The project's main branch. */
  main: (project: string) => string
  /** The task's worktree or slot, made or found; asking again for the same task finds the same place. */
  place: (project: string, task: string, options?: PlaceOptions) => Promise<TaskPlace>
  /** The project's commands before start, in the place. */
  setUp: (project: string, task: string, path: string) => Promise<void>
}

// The place of a task is made and set up once: ahead, while the chain waits for the CI of main, or at the launch.
export class TaskPlaces {
  /** The path of each place prepared ahead; `undefined` — its preparation failed. */
  private readonly ahead = new Map<string, Promise<string | undefined>>()

  constructor(private readonly deps: TaskPlacesDeps) {}

  prepare(project: string, task: string): Promise<void> {
    const work = (async () => {
      const place = await this.deps.place(project, task, { ahead: true })
      await this.deps.setUp(project, task, place.path)
      return place.path
    })()
    this.ahead.set(task, work.catch(() => undefined))
    return work.then(() => undefined)
  }

  /**
   * The place for the launch, on the task branch. One prepared ahead is brought up to main if nothing of the task is in it yet;
   * the commands run again only when it moved, its preparation failed or the launch had to take another place.
   */
  async ready(project: string, task: string): Promise<TaskPlace> {
    const at = await this.ahead.get(task)
    this.ahead.delete(task)
    return this.settle(project, task, at, {})
  }

  /** The place made ready now, still without the task branch, and kept as prepared, so the launch that follows does not set it up again. */
  async readyAhead(project: string, task: string): Promise<TaskPlace> {
    const at = await this.ahead.get(task)
    const place = await this.settle(project, task, at, { ahead: true })
    this.ahead.set(task, Promise.resolve(place.path))
    return place
  }

  private async settle(project: string, task: string, at: string | undefined, options: PlaceOptions): Promise<TaskPlace> {
    const place = await this.deps.place(project, task, at === undefined ? options : { ...options, at })
    const moved = await catchUp(this.deps.git, place.path, this.deps.main(project))
    if (at !== place.path || moved) await this.deps.setUp(project, task, place.path)
    return place
  }
}
