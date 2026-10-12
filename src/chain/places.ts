import { catchUp } from '../git/worktree.js'
import type { Git, TaskPlace } from '../git/types.js'

export interface TaskPlacesDeps {
  git: Git
  /** The task's worktree or slot, made or found; asking again for the same task finds the same place. */
  place: (project: string, task: string) => Promise<TaskPlace>
  /** The project's commands before start, in the place. */
  setUp: (project: string, task: string, path: string) => Promise<void>
}

// The place of a task is made and set up once: ahead, while the chain waits for the CI of main, or at the launch.
export class TaskPlaces {
  private readonly ahead = new Map<string, Promise<void>>()

  constructor(private readonly deps: TaskPlacesDeps) {}

  prepare(project: string, task: string): Promise<void> {
    const work = (async () => {
      const place = await this.deps.place(project, task)
      await this.deps.setUp(project, task, place.path)
    })()
    this.ahead.set(task, work)
    return work
  }

  /**
   * The place for the launch. One prepared ahead is brought up to main if nothing of the task is in it yet;
   * the commands run again only when it moved or its preparation failed.
   */
  async ready(project: string, task: string): Promise<TaskPlace> {
    const ahead = this.ahead.get(task)
    this.ahead.delete(task)
    const prepared = ahead !== undefined && (await ahead.then(() => true, () => false))
    const place = await this.deps.place(project, task)
    const moved = await catchUp(this.deps.git, place.path)
    if (!prepared || moved) await this.deps.setUp(project, task, place.path)
    return place
  }
}
