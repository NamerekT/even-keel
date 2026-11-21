import { TrackerNotFound, type NewTask, type TaskSource, type TrackerAdapter } from '../tracker/source.js'
import type { TaskRef, TrackerCard } from '../tracker/card.js'
import type { TaskEditor } from '../tracker/editor.js'
import type { ImportAuthor, ImportLink, ImportSource } from '../tracker/import.js'
import { sameName } from '../chain/rules.js'
import { changedLabels } from '../tracker/labels.js'
import type { TaskStatus, TrackerTask } from '../tracker/model.js'
import { fakeTask } from '../tracker/fixture.js'

export const BACKLOG: TaskStatus = { name: 'Backlog', category: 'UnStarted' }
export const TODO: TaskStatus = { name: 'Todo', category: 'ToDo' }
export const ACTIVE: TaskStatus = { name: 'In Progress', category: 'Active' }
export const DONE: TaskStatus = { name: 'Done', category: 'Won' }
/** A second done status, after the first: a source may choose it for its closes (BTN-554). */
export const RELEASED: TaskStatus = { name: 'Released', category: 'Won' }
const STATUSES = [BACKLOG, TODO, ACTIVE, DONE, RELEASED, { name: 'Canceled', category: 'Lost' }] as const

/** The name the board's tracker goes under in `ADAPTERS` and in a project's `tracker`. */
export const BOARD_TRACKER = 'board'
/** The board's one variable: a profile of the tracker needs a value to be on. */
export const BOARD_VARIABLE = 'BOARD_TOKEN'
/** The MCP server a session would read the board through; no package of the bench brings it. */
export const BOARD_SERVER = 'board'

/** What a board is to the service: the tracker's title, its one variable and its MCP server. */
export interface BoardKind {
  title: string
  variable: string
  server: string
}

/** The kind of the project's own board. */
export const BOARD: BoardKind = { title: 'Board', variable: BOARD_VARIABLE, server: BOARD_SERVER }

/** A tracker in memory: the scenario files tasks on it and reads what the service did to them. */
export class Board {
  constructor(private readonly kind: BoardKind = BOARD) {}

  readonly tasks = new Map<string, TrackerTask>()
  readonly comments = new Map<string, string[]>()
  /** While set, `complete` throws with this text, as a tracker refusing the transition does. */
  refuseComplete: string | null = null
  /** How many times the service asked to close a task, refused or not. */
  completions = 0
  /** While set, `relabel` throws with this text. */
  refuseRelabel: string | null = null
  /** While set, every read of tasks throws with this text, as a tracker that does not answer does. */
  failReads: string | null = null
  /** The key of each project's tasks by its id: a project reads only the tasks of its key; one not here reads all. */
  readonly keys = new Map<string, string>()
  /** The tasks the service created (the fix of a red main), by id, with what it asked for. */
  readonly created = new Map<string, NewTask>()

  add(id: string, ...blockedBy: string[]): void {
    this.tasks.set(id, { ...fakeTask(id), blockedBy })
  }

  /** Files `id` as a subtask of `parent`, which counts it. */
  child(id: string, parent: string): void {
    this.tasks.set(id, { ...fakeTask(id), parent })
    this.tasks.get(parent)!.subtasks++
  }

  status(id: string): string {
    return this.tasks.get(id)!.status.name
  }

  /** The user moves the task on the tracker's page. */
  move(id: string, status: TaskStatus): void {
    this.tasks.get(id)!.status = status
  }

  labels(id: string): string[] {
    return this.tasks.get(id)!.labels
  }

  /** The user sets the task's labels on the tracker's page. */
  label(id: string, ...labels: string[]): void {
    this.tasks.get(id)!.labels = labels
  }

  commentsOf(id: string): string[] {
    return this.comments.get(id) ?? []
  }

  /** A comment of the user on the task, as the tracker's page would post it; returns its id. */
  reply(id: string, body: string): string {
    const list = this.comments.get(id) ?? []
    list.push(body)
    this.comments.set(id, list)
    return `${id}-comment-${list.length}`
  }

  /** The adapter to register in `ADAPTERS`: every profile and project reads this board. */
  adapter(): TrackerAdapter {
    const { title, variable, server } = this.kind
    return {
      title,
      variables: [variable],
      hostVariables: [],
      help: '',
      mcpServer: server,
      moves: true,
      profileName: () => title,
      account: async () => ({ login: 'john', name: title, expiresAt: null }),
      projects: async () => [],
      setup: (env) => (env[variable] === undefined ? undefined : { connect: async () => this.source(), issueUrl: () => null }),
    }
  }

  private read(): void {
    if (this.failReads !== null) throw new Error(this.failReads)
  }

  /** Moves a task of `from`'s categories to the first status of `to`'s category; `null` — it is elsewhere. */
  private shift(id: string, from: TaskStatus['category'][], to: TaskStatus): TaskStatus | null {
    const task = this.tasks.get(id)
    if (task === undefined || !from.includes(task.status.category)) return null
    task.status = to
    return to
  }

  private source(): TaskSource {
    const copy = (task: TrackerTask) => structuredClone(task)
    return {
      chainTasks: async (project, open) => {
        this.read()
        const key = this.keys.get(project)
        const own = (task: TrackerTask) => key === undefined || task.id.startsWith(`${key}-`)
        return { tasks: [...this.tasks.values()].filter((task) => own(task) && open(task.status)).map(copy), statuses: STATUSES.map((status) => status.name) }
      },
      tasks: async (ids) => {
        this.read()
        return ids.flatMap((id) => (this.tasks.has(id) ? [copy(this.tasks.get(id)!)] : []))
      },
      brief: async (id) => ({ title: this.tasks.get(id)?.title ?? id, description: '' }),
      complete: async (id, status) => {
        this.completions++
        if (this.refuseComplete !== null) throw new Error(this.refuseComplete)
        const task = this.tasks.get(id)
        if (task === undefined || task.status.category === 'Won' || task.status.category === 'Lost') return false
        task.status = STATUSES.find((each) => each.category === 'Won' && (status === undefined || sameName(each.name, status)))!
        return true
      },
      moveTo: async (id, name) => {
        const task = this.tasks.get(id)
        const status = STATUSES.find((each) => sameName(each.name, name))
        if (task === undefined || status === undefined) return null
        task.status = status
        return status
      },
      statuses: async () => [...STATUSES],
      children: async (id) => {
        this.read()
        return [...this.tasks.values()].filter((task) => task.parent === id).map(copy)
      },
      ready: async (id) => this.shift(id, ['UnStarted'], TODO),
      unready: async (id) => this.shift(id, ['ToDo', 'Active'], BACKLOG),
      relabel: async (id, change) => {
        if (this.refuseRelabel !== null) throw new Error(this.refuseRelabel)
        const task = this.tasks.get(id)!
        task.labels = changedLabels(task.labels, change)
        return [...task.labels]
      },
      comment: async (id, body) => this.reply(id, body),
      create: async (task) => {
        const key = this.keys.get(task.project) ?? 'TASK'
        const id = `${key}-${100 + this.created.size + 1}`
        const milestone = task.milestoneOf === null ? null : (this.tasks.get(task.milestoneOf)?.milestone ?? null)
        this.tasks.set(id, fakeTask(id, { title: task.title, priority: task.priority, milestone }))
        this.created.set(id, task)
        return id
      },
      commentsAfter: async (id, after) => {
        const number = after.startsWith(`${id}-comment-`) ? Number(after.slice(`${id}-comment-`.length)) : NaN
        if (!Number.isInteger(number) || number > this.commentsOf(id).length) return []
        return this.commentsOf(id).slice(number).map((body, index) => ({ id: `${id}-comment-${number + index + 1}`, body, files: [] }))
      },
      card: async (id) => this.card(id),
      editor: this.editor(),
      importSource: async (project) => this.importSource(project),
      close: async () => {},
    }
  }

  /** The project's whole history for an import (BTN-1405): its tasks, blocks and comments, every comment the user's. */
  private importSource(project: string): ImportSource {
    const key = this.keys.get(project)
    const link = (id: string): ImportLink => ({ ref: id, id, foreign: key !== undefined && !id.startsWith(`${key}-`) })
    const user: ImportAuthor = { kind: 'user', name: 'John Doe' }
    const own = () => [...this.tasks.values()].filter((task) => key === undefined || task.id.startsWith(`${key}-`))
    return {
      // The board keeps a milestone on its tasks alone: those of the project's tasks, planned.
      milestoneGaps: ['status', 'description', 'closedAt'],
      milestones: async () => {
        const milestones = new Map(own().flatMap((task) => (task.milestone === null ? [] : [[task.milestone.label.toLowerCase(), task.milestone] as const])))
        return [...milestones.values()].map((each) => ({ name: each.label, date: each.targetDate, status: 'planned' as const, description: '', closedAt: null }))
      },
      tasks: async () =>
        own()
          .map((task) => ({
            ref: task.id,
            number: Number(task.id.slice(task.id.lastIndexOf('-') + 1)),
            id: task.id,
            title: task.title,
            description: '',
            images: [],
            status: task.status,
            priority: task.priority,
            milestone: task.milestone?.label ?? null,
            component: null,
            labels: [...task.labels],
            estimate: task.estimate,
            parent: task.parent === null ? null : link(task.parent),
            blocks: [...this.tasks.values()].filter((other) => other.blockedBy.includes(task.id)).map((other) => link(other.id)),
            blockedBy: task.blockedBy.map(link),
            related: [],
            createdAt: 0,
            createdBy: user,
            closedAt: null,
            modifiedAt: null,
          })),
      comments: async (ref) => this.commentsOf(ref).map((body, index) => ({ ref: `${ref}-comment-${index + 1}`, author: user, at: index, body, images: [], files: [], replyTo: null })),
      files: async () => [],
    }
  }

  /** The task as its card shows it: what the check after a copy reads back (BTN-1291). */
  private card(id: string): TrackerCard {
    const task = this.tasks.get(id)
    if (task === undefined) throw new TrackerNotFound(`${id} is not on the board`)
    const ref = (other: string): TaskRef => ({ id: other, title: this.tasks.get(other)?.title ?? other, status: this.tasks.get(other)?.status ?? TODO })
    return {
      id,
      title: task.title,
      description: '',
      status: task.status,
      priority: task.priority,
      labels: [...task.labels],
      milestone: task.milestone,
      parent: task.parent === null ? null : ref(task.parent),
      blockedBy: task.blockedBy.map(ref),
      blocks: [...this.tasks.values()].filter((other) => other.blockedBy.includes(id)).map((other) => ref(other.id)),
      related: [],
      comments: this.commentsOf(id).map((text) => ({ author: null, at: 0, text })),
      attachments: [],
    }
  }

  /** Just what a copy of tasks into the board writes (BTN-1074): a task numbered within its key, a blocking link, a comment. */
  private editor(): TaskEditor {
    return {
      list: async () => [],
      create: async (project, draft) => {
        const key = this.keys.get(project) ?? 'TASK'
        const id = `${key}-${[...this.tasks.keys()].filter((each) => each.startsWith(`${key}-`)).length + 1}`
        this.tasks.set(id, fakeTask(id, { title: draft.title, parent: draft.parent }))
        return id
      },
      set: async () => false,
      revision: async () => 0,
      describe: async () => false,
      patch: async () => false,
      linkTypes: ['blocks'],
      link: async (id, other, _link, on) => {
        const task = this.tasks.get(other)!
        task.blockedBy = on ? [...task.blockedBy, id] : task.blockedBy.filter((each) => each !== id)
      },
      relabel: async () => [],
      comment: async (id, body) => this.reply(id, body),
    }
  }
}
