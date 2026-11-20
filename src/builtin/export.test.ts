import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { openDatabase } from '../storage/database.js'
import type { TrackerCard } from '../tracker/card.js'
import type { TaskDraft, TaskEditor } from '../tracker/editor.js'
import { TrackerNotFound } from '../tracker/source.js'
import type { OpenedExportTarget } from '../tracker/export-target.js'
import { builtinControl } from './control.js'
import { BuiltinExports } from './export.js'
import { BuiltinFiles } from './files.js'
import { builtinSource } from './source.js'
import { BuiltinStore } from './store.js'
import type { SwitchDeps } from './switch.js'
import { emptyChainState, type ChainState } from '../chain/model.js'
import { parseConfig } from '../config.js'
import type { EventDraft } from '../event-log/model.js'

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
  await db.exec(`truncate builtin_history, builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_components, builtin_task_labels, builtin_relations, builtin_comments,
    builtin_files, tracker_exports, tracker_export_tasks, tracker_transfers`)
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
function fakeTarget(options: { failComment?: boolean; components?: string[] } = {}) {
  const created: TaskDraft[] = []
  const comments: { id: string; body: string }[] = []
  const attached: string[] = []
  const attachedTo: string[] = []
  const lost = new Set<number>()
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
      files: {
        attach: async (id, files) => {
          attached.push(...files.map((each) => each.name))
          attachedTo.push(...files.map(() => id))
        },
        comment: async () => '',
      },
      ...(options.components === undefined ? {} : { components: true as const }),
    }
    return {
      title: 'GitHub', project: ABC, editor, close: async () => {},
      vocabulary: {
        statuses: [{ name: 'Open', category: 'ToDo' }, { name: 'Open', category: 'Active' }], labels: ['Bug'], milestones: [],
        ...(options.components === undefined ? {} : { components: options.components }),
      },
      url: (key) => `https://github.example.com/${key}`,
      read: async (key) => card(key),
    }
  }
  /** A created task read back as the check reads it; `lose` — the attachments dropped since. */
  const card = (key: string): TrackerCard => {
    const draft = created[Number(key.slice(3)) - 1]
    if (draft === undefined) throw new TrackerNotFound(`${key} is gone`)
    const status = { name: 'Open', category: 'ToDo' } as const
    const ref = (id: string) => ({ id, title: id, status })
    const linked = (kind: string) => links.map((each) => each.split(' ')).filter(([, link]) => link === kind)
    return {
      id: key, title: draft.title, description: '', status, priority: 'none', labels: draft.labels,
      milestone: draft.milestone === null ? null : { label: draft.milestone, targetDate: null },
      parent: draft.parent === null ? null : ref(draft.parent),
      blocks: linked('blocks').filter(([from]) => from === key).map(([, , to]) => ref(to!)),
      blockedBy: linked('blocks').filter(([, , to]) => to === key).map(([from]) => ref(from!)),
      related: [],
      comments: comments.filter((each) => each.id === key).map((each, index) => ({ id: String(index), body: each.body, author: 'bot', at: 0 }) as unknown as TrackerCard['comments'][number]),
      attachments: attachedTo.flatMap((id, index) => (id === key && !lost.has(index) ? [{ file: attached[index]!, name: attached[index]!, type: '', size: 0, url: null }] : [])),
      component: draft.component ?? null,
    }
  }
  return {
    created, comments, attached, links, target,
    /** Drops every attachment from the copies, as a person deleting them there. */
    lose: () => attachedTo.forEach((_, index) => lost.add(index)),
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
  it('optionally copies history as one summary and keeps the choice when an interrupted copy resumes', async () => {
    await store.create({ project: ABC, title: 'History' })
    const tracker = fakeTarget({ failComment: true })
    const exports = exportsWith(tracker)
    const target = { ...TARGET, history: true }
    expect((await exports.plan(ABC, target)).counts.comments).toBe(1)
    expect((await exports.plan(ABC, TARGET)).counts.comments).toBe(0)
    await exports.start(ABC, target)
    await exports.settled(ABC)
    const restarted = exportsWith(tracker)
    expect((await restarted.state(ABC)).target).toEqual(target)
    await restarted.start(ABC, TARGET)
    await restarted.settled(ABC)
    expect(tracker.comments).toHaveLength(1)
    expect(tracker.comments[0]?.body).toContain('Change history')
    expect(tracker.comments[0]?.body).toContain('| When (UTC) | Who | Field | Before → after |')
    await restarted.start(ABC, target)
    await restarted.settled(ABC)
    expect(tracker.comments).toHaveLength(1)
  })
  it('plans the open tasks with what the target lacks, writing nothing', async () => {
    await seed()
    const tracker = fakeTarget()
    const plan = await exportsWith(tracker).plan(ABC, TARGET)
    expect(plan.tasks).toEqual([{ id: 'ABC-1', title: 'Parent', status: 'Open' }, { id: 'ABC-2', title: 'Child', status: 'Open' }])
    expect(plan.losses.map((each) => [each.kind, each.names])).toEqual([['estimate', []], ['labels', ['Later']], ['milestones', ['v1']], ['history', []]])
    expect(tracker.created).toEqual([])
    expect(await db.query('select 1 from tracker_exports')).toMatchObject({ rows: [] })
  })

  it('gives a task the target’s component of its name, and plans the rest as lost (BTN-1288)', async () => {
    await store.saveComponent(ABC, null, { name: 'Parser', description: '' })
    await store.saveComponent(ABC, null, { name: 'Docs', description: '' })
    await store.create({ project: ABC, title: 'Read', component: 'Parser' })
    await store.create({ project: ABC, title: 'Write', component: 'Docs' })
    const lost = (plan: Awaited<ReturnType<BuiltinExports['plan']>>) => plan.losses.find((each) => each.kind === 'components')
    expect(lost(await exportsWith(fakeTarget()).plan(ABC, TARGET))).toEqual({ kind: 'components', tasks: ['ABC-1', 'ABC-2'], names: ['Parser', 'Docs'] })
    const tracker = fakeTarget({ components: ['parser'] })
    const exports = exportsWith(tracker)
    expect(lost(await exports.plan(ABC, TARGET))).toEqual({ kind: 'components', tasks: ['ABC-2'], names: ['Docs'] })
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    expect(tracker.created.map((draft) => [draft.title, draft.component ?? null])).toEqual([['Read', 'parser'], ['Write', null]])
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

  it('counts the open tasks the copy is to take, before it starts and while it goes', async () => {
    await seed()
    const exports = exportsWith(fakeTarget())
    expect(await exports.state(ABC)).toMatchObject({ total: 2, progress: { tasks: 0 } })
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    expect(await exports.state(ABC)).toMatchObject({ total: 2, progress: { marked: 2 } })
  })

  it("names a copied task's new key where the page still shows the old one: the search and the card's links (BTN-1075)", async () => {
    const { one } = await seed()
    const control = builtinControl({ db, places: () => PLACES, refresh: async () => true })
    expect((await control.search('Parent', null))[0]?.moved).toBeUndefined()
    const exports = exportsWith(fakeTarget())
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    expect((await control.search('Parent', null))[0]).toMatchObject({ id: 'ABC-1', moved: { key: 'GH-1', url: 'https://github.example.com/GH-1' } })
    const card = await builtinSource(db, PLACES).card('ABC-2')
    expect(card.parent).toMatchObject({ id: 'ABC-1', moved: { key: 'GH-1' } })
    expect(card.blockedBy).toMatchObject([{ id: 'ABC-1', moved: { key: 'GH-1' } }])
    const old = await store.create({ project: ABC, title: 'Later one', parent: one })
    expect((await builtinSource(db, PLACES).card(`ABC-${old}`)).parent?.moved).toEqual({ key: 'GH-1', url: 'https://github.example.com/GH-1' })
  })

  it('writes the start, the stop with its cause, the repeat and the end into the event log (BTN-1193)', async () => {
    await seed()
    const events: EventDraft[] = []
    const target = fakeTarget({ failComment: true })
    const exports = new BuiltinExports({ db, places: () => PLACES, filesDir: dir, connect: async () => target.target(), refresh: async () => true, say: () => {}, event: (draft) => void events.push(draft) })
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    const tracker = { view: 'tracker', project: ABC }
    expect(events).toEqual([
      { level: 'info', notice: { code: 'eventLog.exportStarted', params: { project: ABC, tracker: 'GitHub', place: 'example/repo', newKey: 'GH', total: 2 } }, place: tracker },
      { level: 'warning', notice: { code: 'eventLog.exportFailed', params: { project: ABC, tracker: 'GitHub' }, detail: 'HTTP 502' }, place: tracker },
    ])
    events.length = 0
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    expect(events).toEqual([
      { level: 'info', notice: { code: 'eventLog.exportContinued', params: { project: ABC, tracker: 'GitHub', total: 2 } }, place: tracker },
      { level: 'info', notice: { code: 'eventLog.exportFinished', params: { project: ABC, tracker: 'GitHub', copied: 2 } }, place: tracker },
    ])
    events.length = 0
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    expect(events, 'a finished copy with nothing new to take writes nothing').toEqual([])
  })

  it('refuses a project not on the built-in tracker', async () => {
    expect(await refusal(exportsWith(fakeTarget()).plan('99999999-9999-4999-8999-999999999999', TARGET))).toBe('builtin.noProject')
  })
})

describe('the switch after the copy (BTN-1074)', () => {
  const RAW = { projects: [{ id: ABC, key: 'ABC', tracker: 'builtin', repo: 'C:/example' }] }
  const switching = (chain: Partial<ChainState> = {}) => {
    const renamed: Map<string, string>[] = []
    const moved: unknown[] = []
    const deps: SwitchDeps = {
      config: () => parseConfig(RAW),
      raw: () => RAW,
      profiles: () => ({ profiles: [{ id: 'gh', kind: 'github', name: 'GitHub', values: {}, isDefault: true, login: null, expiresAt: null }], links: {} }),
      chain: () => ({ ...emptyChainState(), ...chain }),
      rename: (_project, names) => void renamed.push(new Map(names)),
      move: (_project, move, profile) => void moved.push({ ...move, profile }),
    }
    return { deps, renamed, moved }
  }
  const exportsSwitching = (tracker: ReturnType<typeof fakeTarget>, deps: SwitchDeps) =>
    new BuiltinExports({ db, places: () => PLACES, filesDir: dir, connect: async () => tracker.target(), refresh: async () => true, say: () => {}, switching: deps })

  it("refuses to plan or start a copy whose tasks would keep the project's prefix, before any task is created", async () => {
    await seed()
    const tracker = fakeTarget()
    const exports = exportsSwitching(tracker, switching().deps)
    expect(await refusal(exports.plan(ABC, { ...TARGET, key: 'ABC' }))).toBe('switch.samePrefix')
    expect(await refusal(exports.start(ABC, { ...TARGET, key: 'ABC' }))).toBe('switch.samePrefix')
    expect(tracker.created).toEqual([])
    expect(await exports.state(ABC)).toMatchObject({ target: null, running: false })
  })

  it('moves the project to the target and renames its copied tasks, once the copy is finished', async () => {
    await seed()
    const tracker = fakeTarget()
    const { deps, renamed, moved } = switching()
    const exports = exportsSwitching(tracker, deps)
    expect(await refusal(exports.switch(ABC))).toBe('switch.noCopy')
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    await exports.switch(ABC)
    expect(renamed).toEqual([new Map([['ABC-1', 'GH-1'], ['ABC-2', 'GH-2']])])
    expect(moved).toEqual([{ tracker: 'github', trackerProject: 'example/repo', key: 'GH', profile: 'gh' }])
  })

  it('writes the switch into the event log with the old key, the new one and its report (BTN-1193, BTN-1291)', async () => {
    await seed()
    const events: EventDraft[] = []
    const exports = new BuiltinExports({
      db, places: () => PLACES, filesDir: dir, connect: async () => fakeTarget().target(), refresh: async () => true, say: () => {},
      switching: switching().deps, trackerTitle: (kind) => (kind === 'github' ? 'GitHub' : kind), event: (draft) => void events.push(draft),
    })
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    events.length = 0
    await exports.switch(ABC)
    const [report] = await exports.transfers(ABC)
    expect(events).toEqual([
      {
        level: 'info',
        notice: { code: 'eventLog.transferMatched', params: { project: ABC, tracker: 'GitHub', from: 'ABC', to: 'GH' } },
        place: { view: 'tracker', project: ABC, transfer: report!.id },
      },
    ])
  })

  it('checks the copy at its end, keeps the plan and freezes both into a report at the switch (BTN-1291)', async () => {
    await seed()
    const exports = exportsSwitching(fakeTarget(), switching().deps)
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    const state = await exports.state(ABC)
    expect(state.checkFailed).toBeNull()
    expect(state.check?.rows.map((row) => [row.kind, row.source, row.target, row.tasks])).toEqual([
      ['tasks', 2, 2, []],
      ['comments', 2, 2, []],
      ['files', 1, 1, []],
      ['links', 2, 2, []],
      ['milestones', 0, 0, []],
      ['labels', 1, 1, []],
    ])
    await exports.switch(ABC)
    const list = await exports.transfers(ABC)
    expect(list).toMatchObject([{ direction: 'export', tracker: 'github', matched: true, tasks: 2 }])
    const report = await exports.transfer(list[0]!.id)
    expect(report).toMatchObject({ project: ABC, place: 'example/repo', key: 'GH', sourceKey: 'ABC', closed: false, check: state.check })
    expect(report?.plan.losses.map((loss) => loss.kind)).toContain('milestones')
    expect(await exports.transfer('transfer-none')).toBeNull()
  })

  it('refuses to switch past a check that did not match until "Repeat" brings the missing over, or the switch goes anyway', async () => {
    await seed()
    const tracker = fakeTarget()
    const { deps, moved } = switching()
    const exports = exportsSwitching(tracker, deps)
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    tracker.lose()
    await exports.retry(ABC)
    await exports.settled(ABC)
    expect(tracker.attached, 'the repeat attaches the lost file again').toEqual(['shot.png', 'shot.png'])
    expect((await exports.state(ABC)).check?.rows.find((row) => row.kind === 'files')).toMatchObject({ source: 1, target: 1 })
    tracker.lose()
    tracker.attached.length = 0
    // A target whose files are gone for good: the repeat attaches nothing new, the check stays short.
    const stuck = new BuiltinExports({
      db, places: () => PLACES, filesDir: join(dir, 'gone'), connect: async () => ({ ...tracker.target(), read: async (key) => ({ ...(await tracker.target().read!(key)), attachments: [] }) }),
      refresh: async () => true, say: () => {}, switching: deps,
    })
    await stuck.retry(ABC)
    await stuck.settled(ABC)
    const check = (await stuck.state(ABC)).check
    expect(check?.rows.find((row) => row.kind === 'files')).toEqual({ kind: 'files', source: 1, target: 0, tasks: ['ABC-1'] })
    expect(await refusal(stuck.switch(ABC))).toBe('switch.mismatch')
    expect(moved).toEqual([])
    await stuck.switch(ABC, true)
    expect(moved).toHaveLength(1)
    expect(await stuck.transfers(ABC)).toMatchObject([{ matched: false }])
  })

  it('keeps the copy finished when its check cannot read the target, and switches only after a check', async () => {
    await seed()
    const tracker = fakeTarget()
    const exports = new BuiltinExports({
      db, places: () => PLACES, filesDir: dir, connect: async () => ({ ...tracker.target(), read: async () => Promise.reject(new Error('HTTP 503')) }),
      refresh: async () => true, say: () => {}, switching: switching().deps,
    })
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    const state = await exports.state(ABC)
    expect(state).toMatchObject({ finishedAt: expect.any(String), failed: null, check: null, checkFailed: { code: 'export.checkFailed', detail: 'HTTP 503' } })
    expect(await refusal(exports.switch(ABC))).toBe('switch.noCheck')
  })

  it('refuses while a task filed after the copy is not copied, or while the copy runs', async () => {
    await seed()
    const tracker = fakeTarget()
    const { deps, moved } = switching()
    const exports = exportsSwitching(tracker, deps)
    await exports.start(ABC, TARGET)
    await exports.settled(ABC)
    await store.create({ project: ABC, title: 'Late' })
    expect(await refusal(exports.switch(ABC))).toBe('switch.notCopied')
    tracker.hold()
    expect(await exports.start(ABC, TARGET)).toMatchObject({ running: true, finishedAt: null })
    expect(await refusal(exports.switch(ABC))).toBe('builtin.exporting')
    tracker.release()
    await exports.settled(ABC)
    expect(tracker.created.map((each) => each.title)).toEqual(['Parent', 'Child', 'Late'])
    expect(moved).toEqual([])
    await exports.switch(ABC)
    expect(moved).toHaveLength(1)
  })
})
