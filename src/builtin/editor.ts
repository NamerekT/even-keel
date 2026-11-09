import { randomUUID } from 'node:crypto'
import { fail } from '../notice/notice.js'
import { patchText, type TaskEditor } from '../tracker/editor.js'
import type { TrackerTask } from '../tracker/model.js'
import type { BuiltinNames } from './source.js'
import type { BuiltinStore, BuiltinTask } from './store.js'

export interface BuiltinEditorDeps {
  store: BuiltinStore
  names: BuiltinNames
  /** The task of this id; throws `builtin.noTask` when there is none. */
  must: (id: string) => Promise<BuiltinTask>
  trackerTask: (task: BuiltinTask) => TrackerTask
}

/**
 * The built-in tracker's writes for the tasks MCP server (BTN-768). A short field is set against the value it holds
 * now, so another field changed meanwhile never refuses it; the description goes by its revision or by patches.
 */
export function builtinEditor({ store, names, must, trackerTask }: BuiltinEditorDeps): TaskEditor {
  // A parent is of the task's own project.
  const parentOf = async (project: string, id: string): Promise<number> => {
    const parent = await must(id)
    if (parent.project !== project) throw fail('builtin.noTask', { task: id })
    return parent.number
  }
  const changed = (before: BuiltinTask, after: BuiltinTask) => after.version !== before.version

  return {
    list: async (project) => (await store.list([project])).map(trackerTask),
    async create(project, draft, _notes, marker) {
      if (!names.knows(project)) throw fail('builtin.noProject', { project })
      const parent = draft.parent === null ? null : await parentOf(project, draft.parent)
      const number = await store.create(
        {
          project,
          title: draft.title,
          description: draft.description,
          ...(draft.status === null ? {} : { status: draft.status }),
          ...(draft.priority === null ? {} : { priority: draft.priority }),
          milestone: draft.milestone,
          parent,
          labels: draft.labels,
          ...(marker === undefined ? {} : { id: marker }),
        },
        names.sharing(project),
      )
      return names.name({ project, number })
    },
    // The marker is the task's row id.
    markers: {
      make: () => randomUUID(),
      async find(project, marker) {
        const number = await store.numberOf(project, marker)
        return number === null ? null : names.name({ project, number })
      },
    },
    async set(id, field) {
      const task = await must(id)
      switch (field.field) {
        case 'title':
          return changed(task, await store.edit(task, { field: 'title', from: task.title, to: field.to }))
        case 'status':
          return changed(task, await store.edit(task, { field: 'status', from: task.status.name, to: field.to }))
        case 'priority':
          return changed(task, await store.edit(task, { field: 'priority', from: task.priority, to: field.to }))
        case 'milestone':
          return changed(task, await store.edit(task, { field: 'milestone', from: task.milestone?.name ?? null, to: field.to }))
        case 'parent': {
          const to = field.to === null ? null : await parentOf(task.project, field.to)
          return changed(task, await store.edit(task, { field: 'parent', from: task.parent, to }))
        }
      }
    },
    revision: async (id) => (await must(id)).descriptionRev,
    async describe(id, text, rev) {
      const task = await must(id)
      return changed(task, await store.setDescription(task, text, rev))
    },
    async patch(id, patches, append) {
      const task = await must(id)
      return changed(task, await store.rewriteDescription(task, (text) => patchText(text, patches, append)))
    },
    async link(id, other, link, on) {
      const [task, to] = [await must(id), await must(other)]
      const [from, onto] = link === 'blockedBy' ? [to, task] : [task, to]
      const kind = link === 'relates' ? 'relates' : 'blocks'
      await (on ? store.relate(from, onto, kind) : store.unrelate(from, onto, kind))
    },
    relabel: async (id, change) => store.relabel(await must(id), change),
    comment: async (id, body, model) => store.comment(await must(id), 'agent', body, model),
  }
}
