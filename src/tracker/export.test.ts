import { describe, expect, it } from 'vitest'
import type { TaskDraft, TaskEditor, TaskLink, TaskUpload } from './editor.js'
import {
  exportPlan, journalEntry, progressOf, runExport, statusFor,
  type ExportComment, type ExportFile, type ExportLog, type ExportRow, type ExportSource, type ExportTarget, type ExportTask,
} from './export.js'
import type { TaskStatus } from './model.js'
import type { TrackerVocabulary } from './source.js'

const status = (name: string, category: TaskStatus['category']): TaskStatus => ({ name, category })
const TODO = status('Todo', 'ToDo')
const REVIEW = status('In Review', 'Active')
const DONE = status('Done', 'Won')

const task = (number: number, fields: Partial<ExportTask> = {}): ExportTask => ({
  ref: `r${number}`, number, id: `ABC-${number}`, title: `Task ${number}`, description: `About ${number}`, status: TODO,
  priority: 'none', milestone: null, labels: [], estimate: null, parent: null, blocks: [], related: [], files: 0, ...fields,
})

class FakeSource implements ExportSource {
  marks: { ref: string; key: string; url: string | null }[] = []
  constructor(
    private readonly list: ExportTask[],
    private readonly journals: Record<string, ExportComment[]> = {},
    private readonly attachments: Record<string, ExportFile[]> = {},
  ) {}
  tasks = async () => this.list
  comments = async (ref: string) => this.journals[ref] ?? []
  files = async (ref: string) => this.attachments[ref] ?? []
  async mark(ref: string, key: string, url: string | null) {
    if (!this.marks.some((each) => each.ref === ref)) this.marks.push({ ref, key, url })
  }
}

type Call = 'create' | 'link' | 'attach' | 'comment'

/** A tracker whose writes are recorded; `failOn` throws on the n-th call of a kind (1-based), once. */
class FakeTracker {
  created: { key: string; draft: TaskDraft; marker: string | undefined }[] = []
  links: { id: string; other: string; link: TaskLink }[] = []
  attached: { id: string; names: string[] }[] = []
  comments: { id: string; body: string }[] = []
  private counts: Record<Call, number> = { create: 0, link: 0, attach: 0, comment: 0 }
  private markers = 0
  failOn: Partial<Record<Call, number>> = {}
  /** The create writes the task, then throws: the answer was lost. */
  loseAnswerOn: number | null = null

  constructor(private readonly options: { markers?: boolean; files?: boolean; linkTypes?: readonly TaskLink[]; blocking?: boolean; estimate?: boolean; priorities?: (labels: string[]) => boolean } = {}) {}

  private tick(call: Call) {
    this.counts[call] += 1
    if (this.failOn[call] === this.counts[call]) {
      delete this.failOn[call]
      throw new Error(`${call} failed`)
    }
  }

  editor(): TaskEditor {
    const { markers = true, files = true, linkTypes, blocking, estimate = true, priorities } = this.options
    const refused = async () => {
      throw new Error('not used')
    }
    return {
      list: async () => [],
      create: async (_project, draft, _notes, marker) => {
        this.tick('create')
        const key = `GH-${this.created.length + 1}`
        this.created.push({ key, draft, marker })
        if (this.loseAnswerOn === this.created.length) {
          this.loseAnswerOn = null
          throw new Error('the answer was lost')
        }
        return key
      },
      ...(markers ? {
        markers: {
          make: () => `m${++this.markers}`,
          find: async (_project: string, marker: string) => this.created.find((each) => each.marker === marker)?.key ?? null,
        },
      } : {}),
      set: refused,
      ...(estimate ? { estimate: refused } : {}),
      ...(files ? {
        files: {
          attach: async (id: string, uploads: readonly TaskUpload[]) => {
            this.tick('attach')
            this.attached.push({ id, names: uploads.map((each) => each.name) })
          },
          comment: refused,
        },
      } : {}),
      ...(priorities === undefined ? {} : { priorities }),
      ...(blocking === undefined ? {} : { blockingLinks: async () => blocking }),
      ...(linkTypes === undefined ? {} : { linkTypes }),
      revision: refused,
      describe: refused,
      patch: refused,
      link: async (id, other, link) => {
        this.tick('link')
        if (!this.links.some((each) => each.id === id && each.other === other && each.link === link)) this.links.push({ id, other, link })
      },
      relabel: refused,
      comment: async (id, body) => {
        this.tick('comment')
        this.comments.push({ id, body })
        return String(this.comments.length)
      },
    }
  }
}

const VOCABULARY: TrackerVocabulary = {
  statuses: [status('Backlog', 'UnStarted'), status('Ready', 'ToDo'), status('Todo', 'ToDo'), status('Doing', 'Active'), status('Closed', 'Won')],
  labels: ['bug', 'Question'],
  milestones: ['v1'],
}

const target = (tracker: FakeTracker, vocabulary: TrackerVocabulary | null = VOCABULARY): ExportTarget => ({
  project: 'p', editor: tracker.editor(), vocabulary, url: (key) => `https://tracker.example.com/${key}`,
})

class MemoryLog implements ExportLog {
  readonly saved = new Map<string, ExportRow>()
  rows = async () => [...this.saved.values()]
  async save(row: ExportRow) {
    this.saved.set(row.ref, { ...row })
  }
}

const file = (name: string): ExportFile => ({ name, type: 'text/plain', read: async () => new TextEncoder().encode(name) })
const note = (body: string, fields: Partial<ExportComment> = {}): ExportComment => ({ author: 'person', model: null, body, at: '2026-11-10T08:05:00.000Z', ...fields })

describe('statusFor', () => {
  it('takes the status of the same category and name, ignoring case', () => {
    expect(statusFor(status('todo', 'ToDo'), VOCABULARY.statuses)).toBe('Todo')
  })

  it('takes the first of the category when no name matches; In Review is Active', () => {
    expect(statusFor(REVIEW, VOCABULARY.statuses)).toBe('Doing')
    expect(statusFor(status('Queued', 'ToDo'), VOCABULARY.statuses)).toBe('Ready')
  })

  it('gives null when the target has no status of the category', () => {
    expect(statusFor(status('Canceled', 'Lost'), VOCABULARY.statuses)).toBeNull()
  })
})

describe('exportPlan', () => {
  it('lists the open tasks with their statuses there and what a bare target loses', async () => {
    const source = new FakeSource([
      task(1, { priority: 'high', estimate: 10, blocks: ['r2'], related: ['r2'], files: 1, labels: ['Bug', 'Later'], milestone: 'v2' }),
      task(2, { status: REVIEW, parent: 'r3' }),
      task(3, { status: DONE }),
      task(4, { status: status('Canceled', 'Lost') }),
      task(5, { blocks: ['XYZ-1'], related: ['r3'] }),
    ])
    const bare = new FakeTracker({ markers: false, files: false, estimate: false, linkTypes: ['blocks', 'blockedBy'], blocking: false, priorities: () => false })
    const plan = await exportPlan(source, target(bare, { ...VOCABULARY, statuses: VOCABULARY.statuses.filter((each) => each.category !== 'Active') }))
    expect(plan.tasks).toEqual([
      { id: 'ABC-1', title: 'Task 1', status: 'Todo' },
      { id: 'ABC-2', title: 'Task 2', status: null },
      { id: 'ABC-5', title: 'Task 5', status: 'Todo' },
    ])
    expect(plan.losses).toEqual([
      { kind: 'priority', tasks: ['ABC-1'], names: [] },
      { kind: 'estimate', tasks: ['ABC-1'], names: [] },
      { kind: 'blocks', tasks: ['ABC-1'], names: [] },
      { kind: 'relates', tasks: ['ABC-1'], names: [] },
      { kind: 'files', tasks: ['ABC-1'], names: [] },
      { kind: 'labels', tasks: ['ABC-1'], names: ['Later'] },
      { kind: 'milestones', tasks: ['ABC-1'], names: ['v2'] },
      { kind: 'status', tasks: ['ABC-2'], names: ['In Review'] },
      { kind: 'parent', tasks: ['ABC-2'], names: [] },
      { kind: 'links', tasks: ['ABC-5'], names: [] },
      { kind: 'markers', tasks: [], names: [] },
    ])
  })

  it('loses nothing on a target that keeps every field', async () => {
    const source = new FakeSource([task(1, { priority: 'high', estimate: 10, blocks: ['r2'], related: ['r2'], files: 1, labels: ['bug'], milestone: 'V1' }), task(2)])
    expect((await exportPlan(source, target(new FakeTracker()))).losses).toEqual([])
  })

  it('takes every label and milestone for lost on a target without a vocabulary', async () => {
    const source = new FakeSource([task(1, { labels: ['bug'], milestone: 'v1' })])
    const plan = await exportPlan(source, target(new FakeTracker(), null))
    expect(plan.losses.map((each) => [each.kind, each.names])).toEqual([['labels', ['bug']], ['milestones', ['v1']], ['status', ['Todo']]])
  })
})

describe('runExport', () => {
  const tasks = () => [
    task(3, { parent: 'r1', labels: ['Bug', 'Later'], milestone: 'V1', priority: 'high', estimate: 20, status: REVIEW }),
    task(1, { blocks: ['r3', 'r9'], related: ['r3'] }),
    task(2, { status: DONE }),
    task(9, { status: status('Canceled', 'Lost') }),
  ]

  it('creates parents before children with the target names, then links, files, the journal and the marks', async () => {
    const source = new FakeSource(tasks(), { r3: [note('First'), note('Second', { author: 'agent', model: 'Claude | opus' })] }, { r1: [file('a.txt'), file('b.txt')] })
    const tracker = new FakeTracker()
    const log = new MemoryLog()
    await runExport({ source, target: target(tracker), log })
    expect(tracker.created.map((each) => [each.key, each.draft.title, each.draft.parent])).toEqual([['GH-1', 'Task 1', null], ['GH-2', 'Task 3', 'GH-1']])
    expect(tracker.created[1]!.draft).toMatchObject({ status: 'Doing', labels: ['bug'], milestone: 'v1', priority: 'high', estimate: 20 })
    expect(tracker.created[0]!.draft).toMatchObject({ status: 'Todo', priority: null, milestone: null, labels: [] })
    expect(tracker.links).toEqual([{ id: 'GH-1', other: 'GH-2', link: 'blocks' }, { id: 'GH-1', other: 'GH-2', link: 'relates' }])
    expect(tracker.attached).toEqual([{ id: 'GH-1', names: ['a.txt'] }, { id: 'GH-1', names: ['b.txt'] }])
    expect(tracker.comments).toEqual([
      { id: 'GH-2', body: 'Person, 2026-11-10 08:05 UTC:\n\nFirst' },
      { id: 'GH-2', body: 'Agent (Claude | opus), 2026-11-10 08:05 UTC:\n\nSecond' },
    ])
    expect(source.marks).toEqual([
      { ref: 'r1', key: 'GH-1', url: 'https://tracker.example.com/GH-1' },
      { ref: 'r3', key: 'GH-2', url: 'https://tracker.example.com/GH-2' },
    ])
    expect([...log.saved.values()].map((row) => [row.ref, row.number, row.key, row.stage])).toEqual([['r1', 1, 'GH-1', 'marked'], ['r3', 3, 'GH-2', 'marked']])
    expect(progressOf(await log.rows())).toEqual({ tasks: 2, created: 2, linked: 2, attached: 2, journaled: 2, marked: 2 })
  })

  it('a finished export run again creates and writes nothing', async () => {
    const source = new FakeSource(tasks(), { r3: [note('First')] }, { r1: [file('a.txt')] })
    const tracker = new FakeTracker()
    const log = new MemoryLog()
    await runExport({ source, target: target(tracker), log })
    const before = JSON.stringify([tracker.created, tracker.links, tracker.attached, tracker.comments, source.marks])
    await runExport({ source, target: target(tracker), log })
    expect(JSON.stringify([tracker.created, tracker.links, tracker.attached, tracker.comments, source.marks])).toBe(before)
  })

  it.each([
    ['create', { create: 2 }],
    ['link', { link: 1 }],
    ['attach', { attach: 2 }],
    ['comment', { comment: 2 }],
  ] as const)('a failed %s stops the export; the repeat goes on without a duplicate', async (_name, failOn) => {
    const source = new FakeSource(tasks(), { r3: [note('First'), note('Second'), note('Third')] }, { r1: [file('a.txt'), file('b.txt')] })
    const tracker = new FakeTracker()
    tracker.failOn = { ...failOn }
    const log = new MemoryLog()
    await expect(runExport({ source, target: target(tracker), log })).rejects.toThrow('failed')
    expect(source.marks).toEqual([])
    await runExport({ source, target: target(tracker), log })
    expect(tracker.created.map((each) => each.key)).toEqual(['GH-1', 'GH-2'])
    expect(tracker.attached.map((each) => each.names[0])).toEqual(['a.txt', 'b.txt'])
    expect(tracker.comments.map((each) => each.body.split('\n\n')[1])).toEqual(['First', 'Second', 'Third'])
    expect(tracker.links).toHaveLength(2)
    expect(source.marks.map((each) => each.key)).toEqual(['GH-1', 'GH-2'])
  })

  it('a create whose answer was lost is found by its marker, not made again', async () => {
    const source = new FakeSource(tasks())
    const tracker = new FakeTracker()
    tracker.loseAnswerOn = 1
    const log = new MemoryLog()
    await expect(runExport({ source, target: target(tracker), log })).rejects.toThrow('lost')
    expect([...log.saved.values()]).toMatchObject([{ ref: 'r1', stage: 'pending', marker: 'm1', key: null }])
    await runExport({ source, target: target(tracker), log })
    expect(tracker.created.map((each) => each.key)).toEqual(['GH-1', 'GH-2'])
    expect(log.saved.get('r1')).toMatchObject({ key: 'GH-1', url: 'https://tracker.example.com/GH-1', stage: 'marked' })
  })

  it('leaves out what the target keeps no place for', async () => {
    const source = new FakeSource(tasks(), {}, { r1: [file('a.txt')] })
    const tracker = new FakeTracker({ files: false, estimate: false, linkTypes: ['blocks', 'blockedBy'], blocking: false, priorities: () => false })
    await runExport({ source, target: target(tracker), log: new MemoryLog() })
    expect(tracker.created[1]!.draft).toMatchObject({ priority: null })
    expect(tracker.created[1]!.draft.estimate).toBeUndefined()
    expect(tracker.links).toEqual([])
    expect(tracker.attached).toEqual([])
  })

  it('creates a task without a status where the target has none of its category', async () => {
    const source = new FakeSource([task(1, { status: REVIEW })])
    const tracker = new FakeTracker()
    await runExport({ source, target: target(tracker, { ...VOCABULARY, statuses: [TODO] }), log: new MemoryLog() })
    expect(tracker.created[0]!.draft.status).toBeNull()
  })

  it('skips an attachment whose bytes are gone, with a line in the log', async () => {
    const lines: string[] = []
    const gone: ExportFile = { name: 'gone.png', type: 'image/png', read: async () => null }
    const source = new FakeSource([task(1)], {}, { r1: [gone, file('a.txt')] })
    const tracker = new FakeTracker()
    await runExport({ source, target: target(tracker), log: new MemoryLog(), say: (line) => lines.push(line) })
    expect(tracker.attached).toEqual([{ id: 'GH-1', names: ['a.txt'] }])
    expect(lines).toEqual([expect.stringContaining('gone.png')])
  })
})

describe('journalEntry', () => {
  it('names who wrote it and when', () => {
    expect(journalEntry(note('Hi', { author: 'service' }))).toBe('Even Keel, 2026-11-10 08:05 UTC:\n\nHi')
    expect(journalEntry(note('Hi', { author: 'agent' }))).toBe('Agent, 2026-11-10 08:05 UTC:\n\nHi')
  })
})
