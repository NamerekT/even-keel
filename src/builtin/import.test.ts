import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { emptyChainState } from '../chain/model.js'
import type { TrackerMove } from '../config-form.js'
import { NoticeError } from '../notice/notice.js'
import { openDatabase } from '../storage/database.js'
import type { ImportAuthor, ImportChange, ImportComment, ImportFile, ImportMilestone, ImportSource, ImportTask } from '../tracker/import.js'
import type { OpenedImportSource } from '../tracker/import-source.js'
import { fileUrl } from './files.js'
import { BuiltinImports } from './import.js'
import { listMilestones } from './milestones.js'
import { BuiltinStore } from './store.js'
import { TransferReports } from './transfer-store.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const T0 = Date.UTC(2026, 0, 2, 3, 4, 5)
const V1_DATE = Date.UTC(2026, 2, 1)
const AGENT: ImportAuthor = { kind: 'agent', name: 'Agent Bot' }
const USER: ImportAuthor = { kind: 'user', name: 'John Doe' }
const JANE: ImportAuthor = { kind: 'person', name: 'Jane Doe' }

let db: PGlite
let store: BuiltinStore

beforeAll(async () => {
  db = await openDatabase(undefined)
}, 120_000)
afterAll(() => db.close())
beforeEach(async () => {
  await db.exec(`truncate builtin_history, builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_components, builtin_task_labels, builtin_relations, builtin_comments,
    builtin_files, tracker_imports, tracker_import_tasks, tracker_transfers`)
  store = new BuiltinStore(db, ({ number }) => `ABC-${number}`)
})

const refusal = async (work: Promise<unknown>) => {
  try {
    await work
  } catch (error) {
    return error instanceof NoticeError ? error.notice.code : String(error)
  }
  return 'no refusal'
}

const task = (number: number, fields: Partial<ImportTask> = {}): ImportTask => ({
  ref: `r${number}`,
  number,
  id: `ABC-${number}`,
  title: `Task ${number}`,
  description: '',
  images: [],
  status: { name: 'Todo', category: 'ToDo' },
  priority: 'medium',
  milestone: null,
  component: null,
  labels: [],
  estimate: null,
  parent: null,
  blocks: [],
  blockedBy: [],
  related: [],
  createdAt: T0 + number * 1000,
  createdBy: AGENT,
  closedAt: null,
  modifiedAt: null,
  ...fields,
})

const link = (number: number) => ({ ref: `r${number}`, id: `ABC-${number}`, foreign: false })

const fileOf = (key: string, name: string, text: string): ImportFile => ({
  key,
  name,
  type: 'text/plain',
  size: text.length,
  read: async () => new TextEncoder().encode(text),
})

/** A tracker's whole history kept in memory; `failComments` — the journal's next read after `passComments` throws. */
function fakeSource() {
  const tasks: ImportTask[] = [
    task(3, {
      description: 'Look: ![shot](huly-image:blob1)',
      images: [{ ref: 'huly-image:blob1', file: 'f1' }],
      milestone: 'v1',
      component: 'Server',
      labels: ['Bug'],
    }),
    task(5, {
      parent: link(3),
      blocks: [link(3)],
      related: [{ ref: 'x1', id: 'OTHER-1', foreign: true }],
      status: { name: 'Closed', category: 'Won' },
      closedAt: T0 + 50_000,
      createdBy: USER,
    }),
  ]
  const comments: Record<string, ImportComment[]> = {
    r3: [
      { ref: 'c1', author: USER, at: T0 + 10_000, body: 'from me', images: [], files: [], replyTo: null },
      { ref: 'c2', author: JANE, at: T0 + 11_000, body: 'see the log', images: [], files: ['f2'], replyTo: null },
      { ref: 'c3', author: AGENT, at: T0 + 12_000, body: 'done', images: [], files: [], replyTo: 'c2' },
    ],
  }
  const files: Record<string, ImportFile[]> = { r3: [fileOf('f1', 'shot.png', 'png bytes'), fileOf('f2', 'log.txt', 'log bytes')] }
  const changes: Record<string, ImportChange[]> = {
    r5: [{ at: T0 + 50_000, author: JANE, field: 'status', from: 'Todo', to: 'Done' }],
  }
  const milestones: ImportMilestone[] = [
    { name: 'v1', date: V1_DATE, status: 'completed', description: 'The first one', closedAt: T0 + 70_000 },
    { name: 'v2', date: null, status: 'planned', description: '', closedAt: null },
  ]
  const state = { failComments: 0, passComments: 0, gate: null as Promise<void> | null }
  /** The refs whose journal, files or change log were read. */
  const reads: string[] = []
  const source: ImportSource = {
    tasks: async () => tasks,
    milestones: async () => milestones,
    comments: async (ref) => {
      reads.push(ref)
      if (state.gate !== null) await state.gate
      if (state.failComments > 0 && state.passComments-- <= 0) {
        state.failComments -= 1
        throw new Error('the tracker is down')
      }
      return comments[ref] ?? []
    },
    files: async (ref) => {
      reads.push(ref)
      return files[ref] ?? []
    },
    changes: async (ref) => {
      reads.push(ref)
      return changes[ref] ?? []
    },
  }
  return { source, tasks, milestones, comments, files, changes, state, reads }
}

function imports(source: ImportSource, filesDir = mkdtempSync(join(tmpdir(), 'import-'))) {
  const moves: TrackerMove[] = []
  const renames: ReadonlyMap<string, string>[] = []
  const opened = (): OpenedImportSource => ({ tracker: 'huly', place: '', key: 'ABC', title: 'Huly', source, close: async () => {} })
  const service = new BuiltinImports({
    db,
    open: async () => opened(),
    filesDir,
    refresh: async () => {},
    say: () => {},
    switching: {
      chain: () => emptyChainState(),
      rename: (_project, names) => renames.push(names),
      move: (_project, move) => moves.push(move),
    },
  })
  return { service, moves, renames }
}

const key = (number: number) => ({ project: ABC, number })

describe('the import into the built-in tracker', () => {
  it('keeps the numbers, the parents, the creation time and the author, and the counter goes on from the greatest', async () => {
    const { service } = imports(fakeSource().source)
    await service.start(ABC)
    await service.settled(ABC)
    const parent = await store.get(key(3))
    const child = await store.get(key(5))
    expect(parent).toMatchObject({ title: 'Task 3', status: { name: 'Todo' }, milestone: { name: 'v1' }, component: 'Server', labels: ['Bug'] })
    expect(parent!.createdAt).toBe(new Date(T0 + 3000).toISOString())
    expect(child).toMatchObject({ parent: 3, status: { name: 'Done' }, blocks: [key(3)], related: [] })
    expect((await store.history(key(5)))[0]).toMatchObject({ field: 'created', by: 'person' })
    expect((await store.history(key(5)))[0]!.name).toBeUndefined()
    expect(await store.create({ project: ABC, title: 'next' })).toBe(6)
  })

  it('writes the comments by the authors, a person under the name the tracker gives', async () => {
    const { service } = imports(fakeSource().source)
    await service.start(ABC)
    await service.settled(ABC)
    const comments = await store.comments(key(3))
    expect(comments.map((each) => [each.author, each.name ?? null, each.model, each.at])).toEqual([
      ['person', null, null, new Date(T0 + 10_000).toISOString()],
      ['person', 'Jane Doe', null, new Date(T0 + 11_000).toISOString()],
      ['agent', null, null, new Date(T0 + 12_000).toISOString()],
    ])
  })

  it('writes the authors as the plan picked them', async () => {
    const { service } = imports(fakeSource().source)
    await service.start(ABC, [
      { kind: 'person', name: 'Jane Doe', as: 'user' },
      { kind: 'user', name: 'John Doe', as: 'agent' },
    ])
    await service.settled(ABC)
    const [mine, jane] = await store.comments(key(3))
    expect(mine).toMatchObject({ author: 'agent', model: null })
    expect(jane).toMatchObject({ author: 'person' })
    expect(jane!.name).toBeUndefined()
  })

  it('attaches the files, points the pictures at them and links the other files of a comment', async () => {
    const { service } = imports(fakeSource().source)
    await service.start(ABC)
    await service.settled(ABC)
    const files = await store.files(key(3))
    expect(files.map((each) => each.name).sort()).toEqual(['log.txt', 'shot.png'])
    const shot = files.find((each) => each.name === 'shot.png')!
    const log = files.find((each) => each.name === 'log.txt')!
    expect((await store.get(key(3)))!.description).toBe(`Look: ![shot](${fileUrl('ABC-3', shot.sha256)})`)
    expect((await store.comments(key(3)))[1]!.body).toBe(`see the log\n\n[log.txt](${fileUrl('ABC-3', log.sha256)})`)
  })

  it('writes the change log with its authors, and the check matches', async () => {
    const { service } = imports(fakeSource().source)
    await service.start(ABC)
    await service.settled(ABC)
    const changes = (await store.history(key(5))).filter((each) => each.field !== 'created')
    expect(changes).toMatchObject([{ field: 'status', from: 'Todo', to: 'Done', by: 'person', name: 'Jane Doe', at: T0 + 50_000 }])
    const state = await service.state(ABC)
    expect(state).toMatchObject({ running: false, failed: null, total: 2, progress: { tasks: 2, done: 2 } })
    expect(state.finishedAt).not.toBeNull()
    expect(state.check?.rows.every((row) => row.source === row.target)).toBe(true)
  })

  it("fills a change's missing before from the field's change before it, and the last after is the task's value", async () => {
    const fake = fakeSource()
    fake.tasks[1]!.title = 'Final title'
    fake.changes.r5 = [
      { at: T0 + 20_000, author: JANE, field: 'status', from: null, to: 'In Progress' },
      { at: T0 + 30_000, author: JANE, field: 'title', from: null, to: 'Final title' },
      { at: T0 + 40_000, author: JANE, field: 'status', from: null, to: 'In Review' },
      { at: T0 + 50_000, author: JANE, field: 'status', from: null, to: 'Closed' },
    ]
    const { service } = imports(fake.source)
    await service.start(ABC)
    await service.settled(ABC)
    const changes = (await store.history(key(5))).filter((each) => each.field !== 'created')
    expect(changes.map(({ field, from, to }) => [field, from, to])).toEqual([
      ['status', null, 'In Progress'],
      ['title', null, 'Final title'],
      ['status', 'In Progress', 'In Review'],
      ['status', 'In Review', 'Closed'],
    ])
    expect(changes.filter((each) => each.field === 'status').at(-1)!.to).toBe(fake.tasks[1]!.status.name)
    expect(changes.filter((each) => each.field === 'title').at(-1)!.to).toBe((await store.get(key(5)))!.title)
  })

  it('without a change log writes the closing alone', async () => {
    const fake = fakeSource()
    const { changes: _dropped, ...source } = fake.source
    const { service } = imports(source)
    expect((await service.plan(ABC)).losses.map((each) => each.kind)).toContain('history')
    await service.start(ABC)
    await service.settled(ABC)
    expect((await store.history(key(5))).filter((each) => each.field !== 'created')).toMatchObject([{ field: 'status', to: 'Done', at: T0 + 50_000 }])
    expect((await store.history(key(3))).filter((each) => each.field !== 'created')).toEqual([])
  })

  it('goes on after a failure from where it stopped, writing nothing twice', async () => {
    const fake = fakeSource()
    // The plan reads both tasks' journals; the journal stage's read of the first one fails.
    Object.assign(fake.state, { failComments: 1, passComments: 2 })
    const { service } = imports(fake.source)
    await service.start(ABC)
    await service.settled(ABC)
    expect((await service.state(ABC)).failed?.code).toBe('import.failed')
    expect((await service.state(ABC)).finishedAt).toBeNull()
    await service.start(ABC)
    await service.settled(ABC)
    expect((await service.state(ABC)).failed).toBeNull()
    expect(await store.comments(key(3))).toHaveLength(3)
    expect(await store.files(key(3))).toHaveLength(2)
    expect((await store.list([ABC])).map((each) => each.number)).toEqual([3, 5])
  })

  it('plans what moves, what stays behind and the authors, writing nothing', async () => {
    const { service } = imports(fakeSource().source)
    const plan = await service.plan(ABC, [{ kind: 'person', name: 'Jane Doe', as: 'agent' }])
    expect(plan.counts).toMatchObject({ tasks: 2, comments: 3, files: 2, blocks: 1, subtasks: 1, milestones: 2, labels: 1, components: 1, changes: 1 })
    expect(plan.tasks.map((each) => [each.id, each.status])).toEqual([['ABC-3', 'Todo'], ['ABC-5', 'Done']])
    expect(plan.losses).toEqual([{ kind: 'links', tasks: ['ABC-5'], names: ['OTHER-1'] }])
    expect(plan.authors.find((each) => each.name === 'Jane Doe')).toMatchObject({ comments: 1, changes: 1, tasks: 0, as: 'agent' })
    expect(await store.list([ABC])).toEqual([])
  })

  it('counts the tasks an author created apart from the changes', async () => {
    const { service } = imports(fakeSource().source)
    const plan = await service.plan(ABC)
    expect(plan.authors.find((each) => each.name === 'John Doe')).toMatchObject({ comments: 1, changes: 0, tasks: 1 })
    expect(plan.authors.find((each) => each.kind === 'agent')).toMatchObject({ comments: 1, changes: 0, tasks: 1 })
  })

  it('brings the milestones with their date, status, description and closing time, those without tasks too', async () => {
    const { service } = imports(fakeSource().source)
    await service.start(ABC)
    await service.settled(ABC)
    const milestones = await listMilestones(db, ABC)
    expect(milestones.map(({ name, date, status, description, closedAt, total }) => ({ name, date, status, description, closedAt, total }))).toEqual([
      { name: 'v1', date: V1_DATE, status: 'completed', description: 'The first one', closedAt: new Date(T0 + 70_000).toISOString(), total: 1 },
      { name: 'v2', date: null, status: 'planned', description: '', closedAt: null, total: 0 },
    ])
    expect((await service.state(ABC)).check?.rows.find((row) => row.kind === 'milestones')).toMatchObject({ source: 2, target: 2, tasks: [] })
  })

  it("gives a closed milestone the tracker keeps no closing time of its tasks' last one, and the plan names the gap", async () => {
    const fake = fakeSource()
    fake.source.milestoneGaps = ['closedAt']
    fake.milestones[0] = { ...fake.milestones[0]!, closedAt: null }
    fake.tasks[1] = { ...fake.tasks[1]!, milestone: 'v1' }
    const { service } = imports(fake.source)
    expect((await service.plan(ABC)).losses).toContainEqual({ kind: 'milestones', tasks: [], names: ['closedAt'] })
    await service.start(ABC)
    await service.settled(ABC)
    expect((await listMilestones(db, ABC))[0]).toMatchObject({ name: 'v1', closedAt: new Date(T0 + 50_000).toISOString() })
  })

  it("the check sees a milestone whose date or status differs from the tracker's", async () => {
    const { service } = imports(fakeSource().source)
    await service.start(ABC)
    await service.settled(ABC)
    await db.query(`update builtin_milestones set status = 'active', closed_at = null where project_id = $1 and name = 'v1'`, [ABC])
    await service.start(ABC)
    await service.settled(ABC)
    expect((await service.state(ABC)).check?.rows.find((row) => row.kind === 'milestones')).toMatchObject({ source: 2, target: 1, tasks: ['ABC-3'] })
  })

  it("the last pass brings a milestone's new fields and a new milestone", async () => {
    const fake = fakeSource()
    const { service } = imports(fake.source)
    await service.start(ABC)
    await service.settled(ABC)
    fake.milestones[1] = { name: 'v2', date: V1_DATE + 86_400_000, status: 'active', description: 'Next', closedAt: null }
    fake.milestones.push({ name: 'v3', date: null, status: 'canceled', description: '', closedAt: T0 + 80_000 })
    expect(await service.switch(ABC)).toEqual({ key: 'ABC', renamed: 0 })
    const milestones = await listMilestones(db, ABC)
    expect(milestones.map(({ name, date, status, description }) => [name, date, status, description])).toEqual([
      ['v1', V1_DATE, 'completed', 'The first one'],
      ['v2', V1_DATE + 86_400_000, 'active', 'Next'],
      ['v3', null, 'canceled', ''],
    ])
    expect(milestones[2]!.closedAt).toBe(new Date(T0 + 80_000).toISOString())
    const [report] = await new TransferReports(db).list(ABC)
    expect(report).toMatchObject({ matched: true })
  })

  it('refuses a project the built-in tracker already has tasks of', async () => {
    await store.create({ project: ABC, title: 'left from before' })
    const { service } = imports(fakeSource().source)
    expect(await refusal(service.plan(ABC))).toBe('import.hadBuiltin')
    expect(await refusal(service.start(ABC))).toBe('import.hadBuiltin')
  })

  it('switches after a last pass over what changed in the source, and reports the import', async () => {
    const fake = fakeSource()
    const { service, moves, renames } = imports(fake.source)
    expect(await refusal(service.switch(ABC))).toBe('import.notFinished')
    await service.start(ABC)
    await service.settled(ABC)
    fake.comments.r3!.push({ ref: 'c4', author: JANE, at: T0 + 60_000, body: 'one more', images: [], files: [], replyTo: null })
    fake.tasks.push(task(8, { title: 'Late' }))
    fake.tasks[0] = { ...fake.tasks[0]!, title: 'Renamed', labels: ['Bug', 'UI'] }
    expect(await service.switch(ABC)).toEqual({ key: 'ABC', renamed: 0 })
    expect(moves).toEqual([{ tracker: 'builtin', trackerProject: null, key: 'ABC' }])
    expect(renames).toEqual([])
    expect(await store.comments(key(3))).toHaveLength(4)
    expect(await store.get(key(3))).toMatchObject({ title: 'Renamed', labels: ['Bug', 'UI'] })
    expect((await store.get(key(8)))?.title).toBe('Late')
    const [report] = await new TransferReports(db).list(ABC)
    expect(report).toMatchObject({ direction: 'import', tracker: 'huly', matched: true })
    expect((await service.state(ABC)).from).toBeNull()
  })

  it('passes over a task unchanged since the check: the last pass and the check read only the changed and new ones', async () => {
    const fake = fakeSource()
    fake.tasks[0] = { ...fake.tasks[0]!, modifiedAt: T0 + 1 }
    fake.tasks[1] = { ...fake.tasks[1]!, modifiedAt: T0 + 2 }
    const { service } = imports(fake.source)
    await service.start(ABC)
    await service.settled(ABC)
    fake.reads.length = 0
    fake.tasks[1] = { ...fake.tasks[1]!, title: 'Task 5b', related: [link(3)], modifiedAt: T0 + 90_000 }
    fake.changes.r5!.push({ at: T0 + 90_000, author: JANE, field: 'title', from: 'Task 5', to: 'Task 5b' })
    fake.tasks.push(task(8, { title: 'Late', modifiedAt: T0 + 95_000 }))
    expect(await service.switch(ABC)).toEqual({ key: 'ABC', renamed: 0 })
    expect([...new Set(fake.reads)].sort()).toEqual(['r5', 'r8'])
    expect(await store.get(key(5))).toMatchObject({ title: 'Task 5b', related: [key(3)] })
    expect((await store.history(key(5))).filter((each) => each.field === 'title')).toHaveLength(1)
    expect((await store.get(key(8)))?.title).toBe('Late')
    const [report] = await new TransferReports(db).list(ABC)
    expect(report).toMatchObject({ matched: true })
  })

  it('shows the step of the switch while it goes, and refuses a start meanwhile', async () => {
    const fake = fakeSource()
    const { service } = imports(fake.source)
    await service.start(ABC)
    await service.settled(ABC)
    let release = () => {}
    fake.state.gate = new Promise((resolve) => (release = resolve))
    const switching = service.switch(ABC)
    // The journal's read waits at the gate: the pass has taken its tasks and none is through.
    for (let wait = 0; wait < 400 && !fake.reads.includes('r3'); wait += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    expect((await service.state(ABC)).switching).toEqual({ stage: 'pass', done: 0, total: 2 })
    expect(await refusal(service.start(ABC))).toBe('import.running')
    expect(await refusal(service.switch(ABC))).toBe('import.running')
    release()
    await switching
    expect((await service.state(ABC)).switching).toBeNull()
  })

  it('renames the tasks whose ids in the source are not the key and the number', async () => {
    const fake = fakeSource()
    fake.tasks.splice(0, fake.tasks.length, task(4, { id: 'NAM-4' }))
    const { service, renames } = imports(fake.source)
    await service.start(ABC)
    await service.settled(ABC)
    expect(await service.switch(ABC)).toEqual({ key: 'ABC', renamed: 1 })
    expect(renames.map((names) => [...names])).toEqual([[['NAM-4', 'ABC-4']]])
  })
})

describe('a built-in task with its own number', () => {
  it('is made under it, and the counter goes on from the greatest', async () => {
    expect(await store.create({ project: ABC, title: 'old', number: 40 })).toBe(40)
    expect(await store.create({ project: ABC, title: 'next' })).toBe(41)
    expect(await store.create({ project: ABC, title: 'low', number: 7 })).toBe(7)
    expect(await store.create({ project: ABC, title: 'after' })).toBe(42)
  })
})
