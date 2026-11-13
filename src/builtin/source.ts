import { fail } from '../notice/notice.js'
import type { Db } from '../storage/database.js'
import type { CardEdit, TaskRef, TrackerCard } from '../tracker/card.js'
import { parseTaskId, type MilestonePick, type TaskStatus, type TrackerTask } from '../tracker/model.js'
import type { MilestoneTask, TaskSource, TrackerPlace } from '../tracker/source.js'
import { BACKLOG, BUILTIN_LABELS, BUILTIN_STATUSES, builtinStatus, DONE, TODO, uniqueNames, type CommentAuthor } from './model.js'
import { builtinEditor } from './editor.js'
import { movedName, movedTasks, withMoved } from './export-store.js'
import { BuiltinFiles } from './files.js'
import { BuiltinStore, type BuiltinTask, type TaskKey } from './store.js'

/** How the built-in tracker names its tasks: `<KEY>-<N>` by the key of each of its projects. */
export class BuiltinNames {
  constructor(private readonly places: Readonly<Record<string, TrackerPlace>>) {}

  name({ project, number }: TaskKey): string {
    return `${this.places[project]?.key ?? project}-${number}`
  }

  /** The projects an id may be of: those of its key, in the order of their ids. */
  candidates(id: string): TaskKey[] {
    const parsed = parseTaskId(id)
    if (parsed === null) return []
    return Object.entries(this.places)
      .filter(([, place]) => place.key === parsed.project)
      .map(([project]) => project)
      .sort()
      .map((project) => ({ project, number: parsed.number }))
  }

  /** The other projects of the project's key: a new task's number goes past theirs. */
  sharing(project: string): string[] {
    const key = this.places[project]?.key
    return Object.entries(this.places).flatMap(([other, place]) => (other !== project && place.key === key ? [other] : []))
  }

  knows(project: string): boolean {
    return Object.hasOwn(this.places, project)
  }
}

const AUTHORS: Record<CommentAuthor, string | null> = { person: null, agent: 'Agent', service: 'Even Keel' }

/**
 * The built-in tracker as a `TaskSource` (BTN-767): its projects' tasks in the state database, through `BuiltinStore`.
 * A link or a blocker of a project it no longer serves is left out: nothing names that task any more. The attachments
 * are the files of `filesDir` (BTN-773); without it a task has none.
 */
export function builtinSource(db: Db, places: Readonly<Record<string, TrackerPlace>>, filesDir?: string): TaskSource {
  const names = new BuiltinNames(places)
  const store = new BuiltinStore(db, (key) => names.name(key))
  const files = filesDir === undefined ? undefined : new BuiltinFiles(store, filesDir)
  const listed = async (task: BuiltinTask) => (files === undefined ? [] : files.list(task, names.name(task)))

  const find = async (id: string): Promise<BuiltinTask | undefined> => {
    for (const key of names.candidates(id)) {
      const task = await store.get(key)
      if (task !== undefined) return task
    }
    return undefined
  }
  const must = async (id: string): Promise<BuiltinTask> => {
    const task = await find(id)
    if (task === undefined) throw fail('builtin.noTask', { task: id })
    return task
  }
  const ids = (keys: TaskKey[]) => keys.filter((key) => names.knows(key.project)).map((key) => names.name(key))
  const trackerTask = (task: BuiltinTask): TrackerTask => ({
    id: names.name(task),
    title: task.title,
    status: task.status,
    blockedBy: ids(task.blockedBy),
    parent: task.parent === null ? null : names.name({ project: task.project, number: task.parent }),
    subtasks: task.subtasks,
    milestone: task.milestone === null ? null : { label: task.milestone.name, targetDate: task.milestone.date },
    priority: task.priority,
    labels: task.labels,
    // TrackerTask counts hours, the store minutes.
    estimate: task.estimate === null ? null : task.estimate / 60,
  })
  const refs = async (keys: TaskKey[]): Promise<TaskRef[]> => {
    const found: TaskRef[] = []
    const known = keys.filter((each) => names.knows(each.project))
    const moved = await movedTasks(db, [...new Set(known.map((key) => key.project))])
    for (const key of known) {
      const task = await store.get(key)
      if (task !== undefined) found.push(withMoved({ id: names.name(task), title: task.title, status: task.status }, moved.get(movedName(key.project, key.number))))
    }
    return found
  }
  const move = async (id: string, to: TaskStatus, from: TaskStatus['category'][]): Promise<TaskStatus | null> => {
    const task = await must(id)
    if (!from.includes(task.status.category)) return null
    await store.edit(task, { field: 'status', from: task.status.name, to: to.name })
    return to
  }
  const editOf = async (task: BuiltinTask): Promise<CardEdit> => {
    const own = (await store.labels(task.project)).map((label) => label.name)
    const labels = uniqueNames([...BUILTIN_LABELS, ...own])
    const builtin = new Set(BUILTIN_LABELS.map((name) => name.toLocaleLowerCase()))
    return {
      statuses: [...BUILTIN_STATUSES],
      labels: labels.map((name) => ({ name, builtin: builtin.has(name.toLocaleLowerCase()) })),
      ancestors: await refs((await store.ancestors(task)).map((number) => ({ project: task.project, number }))),
      subtasks: (await store.children(task)).map((child) => ({
        id: names.name(child),
        title: child.title,
        status: child.status,
        milestone: child.milestone?.name ?? null,
      })),
    }
  }
  const milestoneOf = async (task: string | null): Promise<string | null> => (task === null ? null : ((await find(task))?.milestone?.name ?? null))

  return {
    async chainTasks(project, open) {
      const all = await store.list([project])
      const live = all.filter((task) => open(task.status))
      const milestones = new Set(live.flatMap((task) => (task.milestone === null ? [] : [task.milestone.name.toLocaleLowerCase()])))
      const closed = all.filter((task) => !open(task.status) && task.milestone !== null && milestones.has(task.milestone.name.toLocaleLowerCase()))
      return { tasks: [...live, ...closed].map(trackerTask), statuses: BUILTIN_STATUSES.map((status) => status.name) }
    },
    async tasks(list) {
      const found: TrackerTask[] = []
      for (const id of list) {
        const task = await find(id)
        if (task !== undefined) found.push(trackerTask(task))
      }
      return found
    },
    async brief(id) {
      const task = await must(id)
      const present = (await listed(task)).filter((file) => !file.missing).map((file) => ({ name: file.name, path: file.path }))
      return { title: task.title, description: task.description, ...(present.length === 0 ? {} : { files: present }) }
    },
    async complete(id, status) {
      const target = status === undefined ? DONE : builtinStatus(status)
      if (target === undefined || target.category !== 'Won') {
        throw fail('tracker.completeRefused', { task: id, ...(status === undefined ? {} : { status }) })
      }
      const task = await must(id)
      if (task.status.category === 'Won' || task.status.category === 'Lost') return false
      await store.edit(task, { field: 'status', from: task.status.name, to: target.name })
      return true
    },
    async moveTo(id, name) {
      const target = builtinStatus(name)
      if (target === undefined) return null
      const task = await must(id)
      await store.edit(task, { field: 'status', from: task.status.name, to: target.name })
      return target
    },
    statuses: async () => [...BUILTIN_STATUSES],
    async file(id, sha256) {
      const task = await find(id)
      return task === undefined || files === undefined ? null : ((await files.read(task, sha256)) ?? null)
    },
    async children(id) {
      const task = await must(id)
      return (await store.children(task)).map(trackerTask)
    },
    async card(id): Promise<TrackerCard> {
      const task = await must(id)
      const parent = task.parent === null ? null : (await refs([{ project: task.project, number: task.parent }]))[0] ?? null
      return {
        id: names.name(task),
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        labels: task.labels,
        milestone: task.milestone === null ? null : { label: task.milestone.name, targetDate: task.milestone.date },
        ...(task.estimate === null ? {} : { estimate: task.estimate }),
        parent,
        blockedBy: await refs(task.blockedBy),
        blocks: await refs(task.blocks),
        related: await refs(task.related),
        comments: (await store.comments(task)).map((each) => ({
          author: AUTHORS[each.author],
          at: Date.parse(each.at),
          text: each.body,
          journal: { id: each.id, by: each.author, model: each.model },
        })),
        attachments: (await listed(task)).map((file) => ({
          file: file.sha256, id: file.id, name: file.name, type: file.type, size: file.size, url: null, path: file.path,
          ...(file.missing ? { missing: true as const } : {}),
        })),
        edit: await editOf(task),
      }
    },
    ready: (id) => move(id, TODO, ['UnStarted']),
    unready: (id) => move(id, BACKLOG, ['ToDo', 'Active']),
    async relabel(id, change) {
      return store.relabel(await must(id), change)
    },
    async comment(id, body) {
      return store.comment(await must(id), 'service', body)
    },
    journal: true,
    async create(task) {
      if (!names.knows(task.project)) throw fail('builtin.noProject', { project: task.project })
      const number = await store.create(
        { project: task.project, title: task.title, description: task.description, priority: task.priority, milestone: await milestoneOf(task.milestoneOf) },
        names.sharing(task.project),
      )
      return names.name({ project: task.project, number })
    },
    async setMilestone(id, of) {
      const task = await must(id)
      const milestone = await milestoneOf(of)
      if (task.milestone !== null || milestone === null) return false
      await store.edit(task, { field: 'milestone', from: null, to: milestone })
      return true
    },
    async milestones(id): Promise<MilestonePick> {
      const task = await must(id)
      const list = await store.milestones(task.project)
      const current = list.find((each) => each.name === task.milestone?.name)?.id ?? null
      return { current, choices: list.map((each) => ({ id: each.id, label: each.name, targetDate: each.date })) }
    },
    async moveMilestone(id, milestone) {
      const task = await must(id)
      const name = milestone === null ? null : ((await store.milestones(task.project)).find((each) => each.id === milestone)?.name ?? null)
      if (milestone !== null && name === null) throw fail('builtin.noMilestone', {})
      await store.edit(task, { field: 'milestone', from: task.milestone?.name ?? null, to: name })
    },
    async milestoneTasks(project, milestone): Promise<MilestoneTask[]> {
      const key = milestone.trim().toLocaleLowerCase()
      const tasks = (await store.list([project])).filter((task) => task.milestone?.name.toLocaleLowerCase() === key)
      const result: MilestoneTask[] = []
      for (const task of tasks) result.push({ ...trackerTask(task), lastComment: (await store.comments(task)).at(-1)?.body ?? null })
      return result
    },
    async vocabulary(project) {
      return {
        statuses: [...BUILTIN_STATUSES],
        labels: uniqueNames([...BUILTIN_LABELS, ...(await store.labels(project)).map((label) => label.name)]),
        milestones: (await store.milestones(project)).map((each) => each.name),
      }
    },
    editor: builtinEditor({ store, names, must, trackerTask, ...(files === undefined ? {} : { files }) }),
    close: async () => {},
  }
}
