import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { openDatabase } from '../storage/database.js'
import type { TaskDraft, TaskEditor } from '../tracker/editor.js'
import type { OpenedExportTarget } from '../tracker/export-target.js'
import { builtinControl } from './control.js'
import { BuiltinExports } from './export.js'
import { BuiltinFiles } from './files.js'
import { builtinSource } from './source.js'
import { BuiltinStore } from './store.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const PLACES = { [ABC]: { key: 'ABC' } }
const TARGET = { profile: 'gh', place: 'example/repo', key: 'GH' }

let db: PGlite
let store: BuiltinStore
let dir: string

beforeAll(async () => {
  db = await openDatabase(undefined)
}, 120_000)
afterAll(() => db.close())
beforeEach(async () => {
  await db.exec(`truncate builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_task_labels, builtin_relations, builtin_comments,
    builtin_files, tracker_exports, tracker_export_tasks`)
  store = new BuiltinStore(db, ({ number }) => `ABC-${number}`)
  dir = mkdtempSync(join(tmpdir(), 'export-'))
})

const refusal = async (work: Promise<unknown>) => {
  try {
    await work
  } catch (error) {
    return error instanceof NoticeError ? error.notice.code : String(error)
  }
  return 'no refusal'
}

/** A tracker that keeps what it is given; `hold` keeps the first create waiting until it is let go. */
function fakeTarget(options: { failComment?: boolean } = {}) {
  const created: TaskDraft[] = []
  const comments: { id: string; body: string }[] = []
  const attached: string[] = []
  const links: string[] = []
  let release = () => {}
  let held = Promise.resolve()
  const target = (): OpenedExportTarget => {
    const editor: TaskEditor = {
      list: async () => [],
      create: async (_project, draft) => {
        await held
        created.push(draft)
        return `GH-${created.length}`
      },
      markers: { make: () => `m${created.length + 1}`, find: async () => null },
      set: async () => false,
      revision: async () => 0,
      describe: async () => false,
      patch: async () => false,
      link: async (id, other, link) => {
        links.push(`${id} ${link} ${other}`)
      },
      relabel: async () => [],
      comment: async (id, body) => {
        if (options.failComment === true) {
          options.failComment = false
          throw new Error('HTTP 502')
        }
        comments.push({ id, body })
        return String(comments.length)
      },
      files: { attach: async (_id, files) => void attached.push(...files.map((each) => each.name)), comment: async () => '' },
    }
    return {
      title: 'GitHub', project: ABC, editor, close: async () => {},
      vocabulary: { statuses: [{ name: 'Open', category: 'ToDo' }, { name: 'Open', category: 'Active' }], labels: ['Bug'], milestones: [] },
      url: (key) => `https://github.example.com/${key}`,
    }
  }
  return {
    created, comments, attached, links, target,
    hold() {
      held = new Promise((resolve) => (release = resolve))
    },
    release: () => release(),
  }
}

const exportsWith = (tracker: ReturnType<typeof fakeTarget>, refresh = vi.fn(async () => true)) =>
  new BuiltinExports({ db, places: () => PLACES, filesDir: dir, connect: async () => tracker.target(), refresh, say: () => {} })

async function seed() {
  const one = await store.create({ project: ABC, title: 'Parent', labels: ['Bug', 'Later'], milestone: 'v1', priority: 'high', estimate: 10 })
  const two = await store.create({ project: ABC, title: 'Child', parent: one, status: 'In Review' })
  await store.create({ project: ABC, title: 'Old', status: 'Done' })
  await store.relate({ project: ABC, number: one }, { project: ABC, number: two }, 'blocks')
  await store.comment({ project: ABC, number: two }, 'person', 'A note')
  await store.comment({ project: ABC, number: two }, 'agent', 'Done the parser', 'Claude | opus')
  await new BuiltinFiles(store, dir).add({ project: ABC, number: one }, { name: 'shot.png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]) })
  return { one, two }
}

describe('BuiltinExports', () => {
  it('plans the open tasks with what the target lacks, writing nothing', async () => {
    await seed()
    const tracker = fakeTarget()
    const plan = await exportsWith(tracker).plan(ABC, TARGET)
    expect(plan.tasks).toEqual([{ id: 'ABC-1', title: 'Parent', status: 'Open' }, { id: 'ABC-2', title: 'Child', status: 'Open' }])
    expect(plan.losses.map((each) => [each.kind, each.names])).toEqual([['estimate', []], ['labels', ['Later']], ['milestones', ['v1']]])
    expect(tracker.created).toEqual([])
    expect(await db.query('select 1 from tracker_exports')).toMatchObject({ rows: [] })
  })

  it('copies the tasks, records each new key and marks the old tasks', async () => {
    const { one, two } = await seed()
    const tracker = fakeTarget()
    const exports = exportsWith(tracker)
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    expect(tracker.created.map((each) => [each.title, each.parent, each.labels])).toEqual([['Parent', null, ['Bug']], ['Child', 'GH-1', []]])
    expect(tracker.links).toEqual(['GH-1 blocks GH-2'])
    expect(tracker.attached).toEqual(['shot.png'])
    expect(tracker.comments.map((each) => each.body.split(',')[0])).toEqual(['Person', 'Agent (Claude | opus)'])
    expect((await store.comments({ project: ABC, number: one })).at(-1)).toMatchObject({ author: 'service', body: 'Moved to [GH-1](https://github.example.com/GH-1).' })
    expect((await store.comments({ project: ABC, number: two })).at(-1)?.body).toBe('Moved to [GH-2](https://github.example.com/GH-2).')
    const state = await exports.state(ABC)
    expect(state).toMatchObject({ target: TARGET, running: false, failed: null, progress: { tasks: 2, marked: 2 } })
    expect(state.finishedAt).not.toBeNull()
    const ids = await store.rowIds(ABC)
    const rows = await db.query<{ task_id: string; number: number; new_key: string; url: string }>('select task_id, number, new_key, url from tracker_export_tasks order by number')
    expect(rows.rows).toEqual([
      { task_id: ids.get(1), number: 1, new_key: 'GH-1', url: 'https://github.example.com/GH-1' },
      { task_id: ids.get(2), number: 2, new_key: 'GH-2', url: 'https://github.example.com/GH-2' },
    ])
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    expect(tracker.created).toHaveLength(2)
  })

  it('refuses changes of the project’s tasks from the page and the tasks server while the copy runs', async () => {
    await seed()
    const tracker = fakeTarget()
    tracker.hold()
    const exports = exportsWith(tracker)
    expect(await exports.start(ABC, TARGET)).toMatchObject({ running: true })
    await vi.waitFor(async () => expect(await refusal(builtinControl({ db, places: () => PLACES, refresh: async () => true }).comment('ABC-1', 'Hi'))).toBe('builtin.exporting'))
    const control = builtinControl({ db, places: () => PLACES, refresh: async () => true })
    expect(await refusal(control.edit('ABC-2', { field: 'title', from: 'Child', to: 'Renamed' }))).toBe('builtin.exporting')
    expect(await refusal(control.create(ABC, { title: 'New' }))).toBe('builtin.exporting')
    const editor = builtinSource(db, PLACES).editor!
    expect(await refusal(editor.comment('ABC-1', 'Hi', null))).toBe('builtin.exporting')
    expect(await refusal(editor.create(ABC, { title: 'New', description: '', status: null, priority: null, milestone: null, labels: [], parent: null }))).toBe('builtin.exporting')
    expect(await editor.revision('ABC-1')).toBe(0)
    tracker.release()
    await exports.settled(ABC)
    expect(await refusal(control.comment('ABC-1', 'Hi'))).toBe('no refusal')
  })

  it('a refused write stops the copy with a code; the repeat goes on without a duplicate', async () => {
    await seed()
    const tracker = fakeTarget({ failComment: true })
    const exports = exportsWith(tracker)
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    const stopped = await exports.state(ABC)
    expect(stopped).toMatchObject({ running: false, finishedAt: null, failed: { code: 'export.failed', params: { tracker: 'GitHub' }, detail: 'HTTP 502' } })
    expect(await refusal(exports.start(ABC, { ...TARGET, key: 'OTHER' }))).toBe('export.otherTarget')
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    expect(tracker.created).toHaveLength(2)
    expect(tracker.comments).toHaveLength(2)
    expect(await exports.state(ABC)).toMatchObject({ failed: null, progress: { marked: 2 } })
  })

  it('refuses a project not on the built-in tracker', async () => {
    expect(await refusal(exportsWith(fakeTarget()).plan('99999999-9999-4999-8999-999999999999', TARGET))).toBe('builtin.noProject')
  })
})
