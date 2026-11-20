import { describe, expect, it } from 'vitest'
import type { TrackerCard } from './card.js'
import type { TaskEditor } from './editor.js'
import { runExport, type ExportComment, type ExportFile, type ExportLog, type ExportRow, type ExportSource, type ExportTarget, type ExportTask } from './export.js'
import type { TaskStatus } from './model.js'
import { TrackerNotFound } from './source.js'
import { checkExport, checkMatched, repairExport, type TransferCheck } from './transfer-check.js'

const TODO: TaskStatus = { name: 'Todo', category: 'ToDo' }
const DONE: TaskStatus = { name: 'Done', category: 'Won' }

const task = (number: number, fields: Partial<ExportTask> = {}): ExportTask => ({
  ref: `r${number}`, number, id: `ABC-${number}`, title: `Task ${number}`, description: '', status: TODO,
  priority: 'none', milestone: null, labels: [], estimate: null, parent: null, blocks: [], related: [], files: 0, comments: 0, ...fields,
})

const note = (body: string): ExportComment => ({ author: 'person', model: null, body, at: '2026-11-10T08:05:00.000Z' })
const file = (name: string, gone = false): ExportFile => ({ name, type: 'text/plain', read: async () => (gone ? null : new TextEncoder().encode(name)) })

function source(tasks: ExportTask[], journals: Record<string, ExportComment[]> = {}, files: Record<string, ExportFile[]> = {}): ExportSource {
  return {
    tasks: async () => tasks,
    comments: async (ref) => journals[ref] ?? [],
    files: async (ref) => files[ref] ?? [],
    mark: async () => {},
  }
}

/** A tracker that keeps what it is written and reads it back as cards. */
class MemoryTracker {
  private made = 0
  readonly tasks = new Map<string, { labels: string[]; milestone: string | null; component: string | null; parent: string | null; blocks: Set<string>; related: Set<string>; comments: string[]; files: string[] }>()

  target(): ExportTarget {
    const get = (id: string) => this.tasks.get(id)!
    const editor: TaskEditor = {
      list: async () => [],
      create: async (_project, draft) => {
        const key = `GH-${++this.made}`
        this.tasks.set(key, { labels: [...draft.labels], milestone: draft.milestone, component: draft.component ?? null, parent: draft.parent, blocks: new Set(), related: new Set(), comments: [], files: [] })
        return key
      },
      set: async (id, field) => {
        if (field.field === 'milestone') get(id).milestone = field.to
        if (field.field === 'parent') get(id).parent = field.to
        if (field.field === 'component') get(id).component = field.to
        return true
      },
      components: true,
      files: { attach: async (id, uploads) => void get(id).files.push(...uploads.map((each) => each.name)), comment: async () => '' },
      revision: async () => 0,
      describe: async () => true,
      patch: async () => true,
      link: async (id, other, kind) => {
        if (kind === 'blocks') get(id).blocks.add(other)
        if (kind === 'relates') {
          get(id).related.add(other)
          get(other).related.add(id)
        }
      },
      relabel: async (id, change) => {
        get(id).labels.push(...change.add)
        return get(id).labels
      },
      comment: async (id, body) => {
        get(id).comments.push(body)
        return String(get(id).comments.length)
      },
    }
    return {
      project: 'p',
      editor,
      vocabulary: { statuses: [TODO, DONE], labels: ['bug', 'docs'], milestones: ['v1'], components: ['UI'] },
      url: () => null,
      read: async (key) => this.card(key),
    }
  }

  card(key: string): TrackerCard {
    const kept = this.tasks.get(key)
    if (kept === undefined) throw new TrackerNotFound(`${key} is gone`)
    const ref = (id: string) => ({ id, title: id, status: TODO })
    const blockedBy = [...this.tasks.entries()].filter(([, each]) => each.blocks.has(key)).map(([id]) => ref(id))
    return {
      id: key, title: key, description: '', status: TODO, priority: 'none', labels: kept.labels,
      milestone: kept.milestone === null ? null : { label: kept.milestone, targetDate: null },
      parent: kept.parent === null ? null : ref(kept.parent),
      blockedBy, blocks: [...kept.blocks].map(ref), related: [...kept.related].map(ref),
      comments: kept.comments.map((body, index) => ({ id: String(index), body, author: 'bot', at: 0 }) as unknown as TrackerCard['comments'][number]),
      attachments: kept.files.map((name) => ({ file: name, name, type: '', size: 0, url: null })),
      component: kept.component,
    }
  }
}

class MemoryLog implements ExportLog {
  readonly saved = new Map<string, ExportRow>()
  rows = async () => [...this.saved.values()]
  async save(row: ExportRow) {
    this.saved.set(row.ref, { ...row })
  }
}

const rows = (check: TransferCheck) => Object.fromEntries(check.rows.map((row) => [row.kind, [row.source, row.target, ...row.tasks]]))

async function copied() {
  const tasks = [
    task(1, { labels: ['Bug', 'Later'], milestone: 'v1', component: 'UI', blocks: ['r2'], related: ['r3', 'r4'], comments: 2, files: 2 }),
    task(2, { parent: 'r1', labels: ['docs'], comments: 1 }),
    task(3, { status: DONE, comments: 4 }),
    task(4, { related: ['r1'] }),
  ]
  const from = source(tasks, { r1: [note('one'), note('two')], r2: [note('three')] }, { r1: [file('a.txt'), file('b.txt')] })
  const tracker = new MemoryTracker()
  const target = tracker.target()
  const log = new MemoryLog()
  await runExport({ source: from, target, log })
  return { from, tracker, target, log }
}

describe('checkExport', () => {
  it('matches a copy that took everything the target keeps, the closed task left out', async () => {
    const { from, target, log } = await copied()
    const check = await checkExport(from, target, await log.rows(), () => new Date('2026-11-20T10:00:00.000Z'))
    expect(check.at).toBe('2026-11-20T10:00:00.000Z')
    expect(rows(check)).toEqual({
      tasks: [3, 3],
      comments: [3, 3],
      files: [2, 2],
      // ABC-1 blocks ABC-2, ABC-2 is its subtask, ABC-1 and ABC-4 relate: once a pair.
      links: [3, 3],
      milestones: [1, 1],
      // "Later" is no label of the target: a loss of the plan, not counted here.
      labels: [2, 2],
      components: [1, 1],
    })
    expect(checkMatched(check)).toBe(true)
  })

  it('names the tasks short of a kind, and something added there hides no missing one', async () => {
    const { from, tracker, target, log } = await copied()
    const one = tracker.tasks.get('GH-1')!
    one.comments.pop()
    one.files.pop()
    one.blocks.clear()
    one.labels = ['Bug', 'question']
    one.milestone = null
    // Parents first: ABC-1 is GH-1, ABC-4 GH-2, ABC-2 GH-3.
    tracker.tasks.get('GH-3')!.comments.push('a person says hello', 'and again')
    const check = await checkExport(from, target, await log.rows())
    expect(rows(check)).toEqual({
      tasks: [3, 3],
      comments: [3, 2, 'ABC-1'],
      files: [2, 1, 'ABC-1'],
      links: [3, 2, 'ABC-1'],
      milestones: [1, 0, 'ABC-1'],
      labels: [2, 2],
      components: [1, 1],
    })
    expect(checkMatched(check)).toBe(false)
  })

  it('counts a task gone from the target and an open task never copied as missing', async () => {
    const { from, tracker, target, log } = await copied()
    tracker.tasks.delete('GH-3')
    const later = source([...(await from.tasks()), task(5)], { r1: [note('one'), note('two')], r2: [note('three')] }, { r1: [file('a.txt'), file('b.txt')] })
    const check = await checkExport(later, target, await log.rows())
    expect(check.rows.find((row) => row.kind === 'tasks')).toEqual({ kind: 'tasks', source: 4, target: 2, tasks: ['ABC-2', 'ABC-5'] })
  })

  it('leaves out the kinds the target does not keep', async () => {
    const { from, target, log } = await copied()
    const { files: _files, components: _components, ...editor } = target.editor
    const check = await checkExport(from, { ...target, editor, vocabulary: { ...target.vocabulary!, milestones: undefined } }, await log.rows())
    expect(check.rows.map((row) => row.kind)).toEqual(['tasks', 'comments', 'links', 'labels'])
  })

  it('refuses a target that cannot read its tasks back', async () => {
    const { from, target, log } = await copied()
    await expect(checkExport(from, { ...target, read: undefined }, await log.rows())).rejects.toThrow('cannot read')
  })
})

describe('repairExport', () => {
  it('brings each copy what it lacks, a task gone created again, and the check then matches', async () => {
    const { from, tracker, target, log } = await copied()
    const one = tracker.tasks.get('GH-1')!
    one.comments.pop()
    one.files.pop()
    one.blocks.clear()
    one.labels = []
    one.milestone = null
    one.component = null
    tracker.tasks.get('GH-3')!.parent = null
    // ABC-4, related to ABC-1: its copy comes back and so does the link.
    tracker.tasks.delete('GH-2')
    await repairExport({ source: from, target, log })
    expect(one.comments).toEqual(['Person, 2026-11-10 08:05 UTC:\n\none', 'Person, 2026-11-10 08:05 UTC:\n\ntwo'])
    expect(one.files).toEqual(['a.txt', 'b.txt'])
    expect(checkMatched(await checkExport(from, target, await log.rows()))).toBe(true)
  })

  it('leaves an attachment with no file behind: the check stays short of it', async () => {
    const tasks = [task(1, { files: 2 })]
    const from = source(tasks, {}, { r1: [file('a.txt'), file('gone.txt', true)] })
    const tracker = new MemoryTracker()
    const target = tracker.target()
    const log = new MemoryLog()
    const said: string[] = []
    await runExport({ source: from, target, log })
    await repairExport({ source: from, target, log, say: (line) => said.push(line) })
    expect(tracker.tasks.get('GH-1')!.files).toEqual(['a.txt'])
    expect(said).toEqual(['export: ABC-1: the attachment gone.txt has no file and is not copied'])
    expect(rows(await checkExport(from, target, await log.rows())).files).toEqual([2, 1, 'ABC-1'])
  })
})
