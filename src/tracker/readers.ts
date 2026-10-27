import type { Dispatcher } from '../chain/dispatcher.js'
import type { ChainView } from '../chain/milestones.js'
import type { Task } from './model.js'

type Chain = Pick<Dispatcher, 'setTasks' | 'setOutside' | 'released' | 'setReleased' | 'held' | 'view' | 'preview'>

export interface ReaderTasksDeps {
  /** The project a reader serves: a feed's owner, a project itself. */
  owner: (reader: string) => string
  /** The readers of a project in the order of its chain: the project, then its feeds. */
  readers: (project: string) => string[]
  /** Whether the task is the reader's: its id carries the reader's prefix. */
  belongs: (reader: string, task: string) => boolean
  /** By project: what the page and the rest of the service see. */
  tasksByProject: Map<string, Task[]>
  dispatcher: Chain
}

/**
 * The tasks of a project's readers (BTN-66) as one: a tracker reads by reader — the project, each of its feeds — and the
 * project's chain and the page get the union. What the chain gives back by project, each reader sees only its part of.
 */
export class ReaderTasks implements Chain {
  private readonly listed = new Map<string, Task[]>()
  private readonly chained = new Map<string, Task[]>()
  private readonly outside = new Map<string, Task[]>()
  private readonly releasedRead = new Map<string, Task[]>()
  /** The project each reader was last read for. */
  private readonly owners = new Map<string, string>()

  constructor(private readonly deps: ReaderTasksDeps) {}

  get(reader: string): Task[] | undefined {
    return this.listed.get(reader)
  }

  has(reader: string): boolean {
    return this.listed.has(reader)
  }

  /** The reader's tasks for the page, the project's own list rebuilt. */
  set(reader: string, tasks: Task[]): void {
    this.listed.set(reader, tasks)
    this.publish(this.ownerOf(reader))
  }

  /** The reader is read no more: its tasks leave the project's lists and its chain. A feed gone from the config goes from the project it was read for. */
  delete(reader: string): void {
    const project = this.owners.get(reader) ?? this.deps.owner(reader)
    this.owners.delete(reader)
    this.listed.delete(reader)
    this.outside.delete(reader)
    this.releasedRead.delete(reader)
    const had = this.chained.delete(reader)
    this.publish(project)
    if (had && this.has(project)) this.deps.dispatcher.setTasks(project, this.union(this.chained, project))
  }

  setTasks(reader: string, tasks: Task[]): void {
    this.chained.set(reader, tasks)
    const project = this.ownerOf(reader)
    this.deps.dispatcher.setTasks(project, this.union(this.chained, project))
  }

  setOutside(reader: string, tasks: Task[]): void {
    this.outside.set(reader, tasks)
    const project = this.ownerOf(reader)
    this.deps.dispatcher.setOutside(project, this.union(this.outside, project))
  }

  released(reader: string): string[] {
    return this.deps.dispatcher.released(this.deps.owner(reader)).filter((id) => this.deps.belongs(reader, id))
  }

  /**
   * The chain judges the project's released tasks all at once and lets go of one it is not given: it gets them only once
   * every reader that has some has read its own.
   */
  setReleased(reader: string, tasks: Task[]): void {
    this.releasedRead.set(reader, tasks)
    const project = this.deps.owner(reader)
    const readers = this.deps.readers(project).filter((each) => this.released(each).length > 0)
    if (readers.some((each) => !this.releasedRead.has(each))) return
    this.deps.dispatcher.setReleased(project, readers.flatMap((each) => this.releasedRead.get(each)!))
  }

  held(reader: string): string[] {
    return this.deps.dispatcher.held(this.deps.owner(reader)).filter((id) => this.deps.belongs(reader, id))
  }

  view(reader: string): ChainView {
    return this.mine(reader, this.deps.dispatcher.view(this.deps.owner(reader)))
  }

  /** The reader's part of the view the chain would have once the reader's tasks are `tasks`. */
  preview(reader: string, tasks: Task[]): ChainView {
    const project = this.deps.owner(reader)
    const all = this.deps.readers(project).flatMap((each) => (each === reader ? tasks : (this.chained.get(each) ?? [])))
    return this.mine(reader, this.deps.dispatcher.preview(project, all))
  }

  private mine(reader: string, { tasks, blockers, current }: ChainView): ChainView {
    const mine = (task: Task) => this.deps.belongs(reader, task.id)
    return { tasks: tasks.filter(mine), blockers: blockers.filter(mine), current: current !== undefined && this.deps.belongs(reader, current) ? current : undefined }
  }

  private ownerOf(reader: string): string {
    const project = this.deps.owner(reader)
    this.owners.set(reader, project)
    return project
  }

  private publish(project: string): void {
    if (!this.deps.readers(project).some((reader) => this.listed.has(reader))) {
      this.deps.tasksByProject.delete(project)
      return
    }
    this.deps.tasksByProject.set(project, this.union(this.listed, project))
  }

  private union(parts: Map<string, Task[]>, project: string): Task[] {
    return this.deps.readers(project).flatMap((reader) => parts.get(reader) ?? [])
  }
}
