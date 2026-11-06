import { fail } from '../notice/notice.js'
import type { Db } from '../storage/database.js'
import type { LabelChange } from '../tracker/labels.js'
import { parseTaskId, type TaskPriority } from '../tracker/model.js'
import type { TrackerPlace } from '../tracker/source.js'
import type { EvenKeelConfig } from '../config.js'
import { BUILTIN, type RelationKind } from './model.js'
import { BuiltinNames } from './source.js'
import { BuiltinStore, type BuiltinTask, type FieldEdit, type TaskKey } from './store.js'

/** A task as the page gets it: every task named by its `<KEY>-<N>`. */
export interface BuiltinView extends Omit<BuiltinTask, 'parent' | 'blockedBy' | 'blocks' | 'related'> {
  id: string
  parent: string | null
  blockedBy: string[]
  blocks: string[]
  related: string[]
}

export interface BuiltinDraft {
  title: string
  description?: string
  status?: string
  priority?: TaskPriority
  milestone?: string | null
  /** The parent's id. */
  parent?: string | null
  labels?: string[]
}

/** An edit of a short field as the page sends it: a parent by its id. */
export type BuiltinEdit =
  | Exclude<FieldEdit, { field: 'parent' }>
  | { field: 'parent'; from: string | null; to: string | null }

/**
 * The page's commands on the built-in tracker's tasks (BTN-767). A task is named by its id, a project by its GUID; a write
 * refreshes the chain's view of the task's project. The refusals are `builtin.*` notices.
 */
export interface BuiltinControl {
  create(project: string, draft: BuiltinDraft): Promise<BuiltinView>
  edit(task: string, edit: BuiltinEdit): Promise<BuiltinView>
  /** Replaces the description whole; `rev` — the description revision the editor started from. */
  describe(task: string, text: string, rev: number): Promise<BuiltinView>
  patch(task: string, old: string, next: string): Promise<BuiltinView>
  relabel(task: string, change: LabelChange): Promise<BuiltinView>
  /** Creates the milestone or sets the date of the one of this name. */
  milestone(project: string, name: string, date: number | null): Promise<{ id: string }>
  /** `blocks` — `task` blocks `other`; `on: false` removes the link. */
  relate(task: string, other: string, kind: RelationKind, on: boolean): Promise<BuiltinView>
  comment(task: string, body: string): Promise<{ id: string }>
  remove(task: string): Promise<void>
}

/** The projects on the built-in tracker with their keys, as the adapter gets them. */
export function builtinPlaces(config: Pick<EvenKeelConfig, 'trackers' | 'keys'>): Record<string, TrackerPlace> {
  return Object.fromEntries(
    Object.entries(config.trackers).flatMap(([project, tracker]) => (tracker === BUILTIN ? [[project, { key: config.keys[project] ?? project }]] : [])),
  )
}

export interface BuiltinControlDeps {
  db: Db
  /** The projects on the built-in tracker with their keys, read per call: the config is live. */
  places: () => Readonly<Record<string, TrackerPlace>>
  refresh: (project: string) => Promise<unknown>
}

export function builtinControl({ db, places, refresh }: BuiltinControlDeps): BuiltinControl {
  const open = () => {
    const names = new BuiltinNames(places())
    return { names, store: new BuiltinStore(db, (key) => names.name(key)) }
  }
  const find = async (names: BuiltinNames, store: BuiltinStore, id: string): Promise<BuiltinTask> => {
    for (const key of names.candidates(id)) {
      const task = await store.get(key)
      if (task !== undefined) return task
    }
    throw fail('builtin.noTask', { task: id })
  }
  const view = (names: BuiltinNames, task: BuiltinTask): BuiltinView => {
    const ids = (keys: TaskKey[]) => keys.filter((key) => names.knows(key.project)).map((key) => names.name(key))
    return {
      ...task,
      id: names.name(task),
      parent: task.parent === null ? null : names.name({ project: task.project, number: task.parent }),
      blockedBy: ids(task.blockedBy),
      blocks: ids(task.blocks),
      related: ids(task.related),
    }
  }
  // A parent is of the task's own project: its number under the project's key.
  const parentNumber = (names: BuiltinNames, task: BuiltinTask, id: string | null): number | null => {
    if (id === null) return null
    const parsed = parseTaskId(id)
    if (parsed === null || `${parsed.project}-${parsed.number}` !== names.name({ project: task.project, number: parsed.number })) {
      throw fail('builtin.noTask', { task: id })
    }
    return parsed.number
  }
  const write = async (id: string, work: (store: BuiltinStore, task: BuiltinTask, names: BuiltinNames) => Promise<unknown>): Promise<BuiltinView> => {
    const { names, store } = open()
    const task = await find(names, store, id)
    await work(store, task, names)
    await refresh(task.project)
    return view(names, (await store.get(task))!)
  }

  return {
    async create(project, draft) {
      const { names, store } = open()
      if (!names.knows(project)) throw fail('builtin.noProject', { project })
      const parent = draft.parent == null ? null : (await find(names, store, draft.parent))
      if (parent !== null && parent.project !== project) throw fail('builtin.noTask', { task: draft.parent! })
      const number = await store.create({ ...draft, project, parent: parent?.number ?? null }, names.sharing(project))
      await refresh(project)
      return view(names, (await store.get({ project, number }))!)
    },
    edit: (id, edit) =>
      write(id, (store, task, names) =>
        edit.field === 'parent'
          ? store.edit(task, { field: 'parent', from: parentNumber(names, task, edit.from), to: parentNumber(names, task, edit.to) })
          : store.edit(task, edit),
      ),
    describe: (id, text, rev) => write(id, (store, task) => store.setDescription(task, text, rev)),
    patch: (id, old, next) => write(id, (store, task) => store.patchDescription(task, old, next)),
    relabel: (id, change) => write(id, (store, task) => store.relabel(task, change)),
    async milestone(project, name, date) {
      const { names, store } = open()
      if (!names.knows(project)) throw fail('builtin.noProject', { project })
      const id = await store.saveMilestone(project, name, date)
      await refresh(project)
      return { id }
    },
    relate: (id, other, kind, on) =>
      write(id, async (store, task, names) => {
        const to = await find(names, store, other)
        await (on ? store.relate(task, to, kind) : store.unrelate(task, to, kind))
        if (to.project !== task.project) await refresh(to.project)
      }),
    async comment(id, body) {
      const { names, store } = open()
      const task = await find(names, store, id)
      const comment = await store.comment(task, 'person', body)
      await refresh(task.project)
      return { id: comment }
    },
    async remove(id) {
      const { names, store } = open()
      const task = await find(names, store, id)
      await store.remove(task)
      await refresh(task.project)
    },
  }
}
