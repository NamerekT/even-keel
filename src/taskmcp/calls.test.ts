import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BuiltinFiles } from '../builtin/files.js'
import { builtinSource } from '../builtin/source.js'
import { BuiltinStore } from '../builtin/store.js'
import { openDatabase } from '../storage/database.js'
import { trackerOf, type Tracker } from '../tracker/source.js'
import type { TrackerCard } from '../tracker/card.js'
import { TasksTools, cardText, type TasksScope } from './calls.js'
import { TasksMcp } from './server.js'
import { toolSpecs } from './tools.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'
const PLACES = { [ABC]: { key: 'ABC' }, [XYZ]: { key: 'XYZ' } }
const CHAIN: TasksScope = { project: ABC, task: 'ABC-1' }
const HAND: TasksScope = { project: null, task: null }

let db: PGlite
let store: BuiltinStore
let tracker: Tracker
let tools: TasksTools
let refreshed: string[]

const deps = () => ({
  db,
  run: <T>(_project: string, call: (each: Tracker) => Promise<T>) => call(tracker),
  projectOfKey: (key: string) => Object.entries(PLACES).find(([, place]) => place.key === key)?.[0] ?? null,
  modelOf: () => 'Claude | opus',
  refresh: async (project: string) => void refreshed.push(project),
})

const call = (name: string, args: Record<string, unknown>, scope = CHAIN) => tools.call(name, args, scope)
const refusal = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('no refusal')
}
const description = async (number: number) => (await store.get({ project: ABC, number }))!.description

beforeAll(async () => {
  db = await openDatabase(undefined)
}, 120_000)
afterAll(() => db.close())
beforeEach(async () => {
  await db.exec('truncate builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_task_labels, builtin_relations, builtin_comments, builtin_files, task_retries')
  tracker = trackerOf(builtinSource(db, PLACES))
  store = new BuiltinStore(db)
  tools = new TasksTools(deps())
  refreshed = []
  await store.saveMilestone(ABC, 'v0.3', null)
  await store.create({ project: ABC, title: 'Parent', description: '## Plan\n\nfirst step\n\nsecond step\n' })
})

describe('tasks_create', () => {
  it('creates a batch with every field and links inside it by #N', async () => {
    const answer = await call('tasks_create', {
      tasks: [
        { title: 'Core', parent: 'ABC-1', milestone: 'V0.3', labels: ['bug'], priority: 'high', status: 'Todo' },
        { title: 'Page', parent: '#1', blockedBy: ['#1'], relates: ['ABC-1'] },
      ],
    })
    expect(answer).toBe('ABC-2 Core\nABC-3 Page')
    const page = await call('task_read', { key: 'ABC-3' })
    expect(page).toContain('parent ABC-2')
    expect(page).toContain('blocked by ABC-2')
    expect(page).toContain('relates ABC-1')
    const core = await call('task_read', { key: 'abc-2' })
    expect(core.split('\n\n')[1]).toBe('Todo · priority high · milestone v0.3 · labels Bug · parent ABC-1 · blocks ABC-3 · rev 0')
    expect(refreshed).toEqual([ABC])
  })

  it('refuses an unknown label or milestone with the existing ones, before anything is created', async () => {
    expect(await refusal(call('tasks_create', { tasks: [{ title: 'A' }, { title: 'B', labels: ['Вопрос'] }] }))).toMatch(/no label "Вопрос"; the labels are Manual, Question, Bug, Rework\. Only the user makes a new one/)
    expect(await refusal(call('tasks_create', { tasks: [{ title: 'A', milestone: 'v9' }] }))).toMatch(/no milestone "v9"; the milestones are v0.3/)
    expect((await store.list([ABC])).length).toBe(1)
  })

  it('refuses a #N outside the call and a parent that comes later', async () => {
    expect(await refusal(call('tasks_create', { tasks: [{ title: 'A', blocks: ['#3'] }] }))).toMatch(/#3 is not a task of this call/)
    expect(await refusal(call('tasks_create', { tasks: [{ title: 'A', parent: '#2' }, { title: 'B' }] }))).toMatch(/parent #2 must come earlier/)
  })

  it('a repeat with the same retry returns the tasks created, with no duplicates', async () => {
    const batch = { tasks: [{ title: 'One' }, { title: 'Two', blocks: ['#1'] }], retry: 'r-1' }
    const first = await call('tasks_create', batch)
    tools = new TasksTools(deps())
    expect(await call('tasks_create', batch)).toBe(first)
    expect((await store.list([ABC])).map((task) => task.title)).toEqual(['Parent', 'One', 'Two'])
  })

  it('saves every created task before starting the next and resumes a partial batch after restart', async () => {
    const editor = tracker.editor!
    let attempts = 0
    tracker.editor = {
      ...editor,
      create: async (project, draft, notes) => {
        const saved = await db.query<{ ids: string }>('select ids from task_retries where project_id = $1 and retry_key = $2', [ABC, 'partial'])
        expect(JSON.parse(saved.rows[0]!.ids)).toEqual(['ABC-2', 'ABC-3'].slice(0, attempts))
        if (++attempts === 3) throw new Error('tracker unavailable')
        return editor.create(project, draft, notes)
      },
    }
    const batch = {
      tasks: [{ title: 'One' }, { title: 'Two', parent: '#1' }, { title: 'Three', blockedBy: ['#2'] }],
      retry: 'partial',
    }
    expect(await refusal(call('tasks_create', batch))).toContain('Created ABC-2 One, ABC-3 Two; then task 3 was refused')
    tracker.editor = editor
    tools = new TasksTools(deps())
    expect(await call('tasks_create', batch)).toBe('ABC-2 One\nABC-3 Two\nABC-4 Three')
    expect((await store.list([ABC])).map((task) => task.title)).toEqual(['Parent', 'One', 'Two', 'Three'])
    expect(await call('task_read', { key: 'ABC-3' })).toContain('parent ABC-2')
    expect(await call('task_read', { key: 'ABC-4' })).toContain('blocked by ABC-3')
  })

  it('a repeat after a crash between the create and the save finds the task by its marker, labels and all', async () => {
    const editor = tracker.editor!
    tracker.editor = {
      ...editor,
      create: async (project, draft, notes, marker) => {
        if (draft.title !== 'Two') return editor.create(project, draft, notes, marker)
        await editor.create(project, { ...draft, labels: [] }, notes, marker)
        throw new Error('process killed')
      },
    }
    const batch = { tasks: [{ title: 'One' }, { title: 'Two', labels: ['bug'], blockedBy: ['#1'] }, { title: 'Three' }], retry: 'crash' }
    await refusal(call('tasks_create', batch))
    const saved = await db.query<{ ids: string; started: string }>('select ids, started from task_retries')
    expect(JSON.parse(saved.rows[0]!.ids)).toEqual(['ABC-2'])
    expect(JSON.parse(saved.rows[0]!.started)).toEqual({ at: 1, marker: expect.any(String) })
    tracker.editor = editor
    tools = new TasksTools(deps())
    expect(await call('tasks_create', batch)).toBe('ABC-2 One\nABC-3 Two (found in the tracker after an interrupted call)\nABC-4 Three')
    expect((await store.list([ABC])).map((task) => task.title)).toEqual(['Parent', 'One', 'Two', 'Three'])
    expect(await call('task_read', { key: 'ABC-3' })).toMatch(/labels Bug · blocked by ABC-2/)
    expect((await db.query('select started from task_retries')).rows).toEqual([{ started: null }])
  })

  it('a started task the tracker never got is created on the repeat with the same marker', async () => {
    const editor = tracker.editor!
    const markers: (string | undefined)[] = []
    tracker.editor = {
      ...editor,
      create: async (project, draft, notes, marker) => {
        markers.push(marker)
        if (markers.length === 2) throw new Error('process killed')
        return editor.create(project, draft, notes, marker)
      },
    }
    const batch = { tasks: [{ title: 'One' }, { title: 'Two' }], retry: 'lost' }
    await refusal(call('tasks_create', batch))
    tools = new TasksTools(deps())
    expect(await call('tasks_create', batch)).toBe('ABC-2 One\nABC-3 Two')
    expect(markers).toHaveLength(3)
    expect(markers[2]).toBe(markers[1])
    expect(new Set(markers).size).toBe(2)
    expect(await tracker.editor.markers!.find(ABC, markers[2]!)).toBe('ABC-3')
  })

  it('an editor without markers creates with none and journals no started position', async () => {
    const editor = tracker.editor!
    const markers: (string | undefined)[] = []
    tracker.editor = { ...editor, markers: undefined, create: async (project, draft, notes, marker) => (markers.push(marker), editor.create(project, draft, notes)) }
    expect(await call('tasks_create', { tasks: [{ title: 'One' }, { title: 'Two' }], retry: 'plain' })).toBe('ABC-2 One\nABC-3 Two')
    expect(markers).toEqual([undefined, undefined])
    expect((await db.query('select started from task_retries')).rows).toEqual([{ started: null }])
  })

  it('a hand session names the project by its key', async () => {
    expect(await refusal(call('tasks_create', { tasks: [{ title: 'A' }] }, HAND))).toMatch(/"project" is required/)
    expect(await call('tasks_create', { project: 'xyz', tasks: [{ title: 'There' }] }, HAND)).toBe('XYZ-1 There')
    expect(await call('tasks_list', { project: 'XYZ' }, HAND)).toBe('XYZ-1 · Todo · There')
    expect(await call('task_read', { key: 'XYZ-1' }, HAND)).toContain('# XYZ-1 There')
    expect(await refusal(call('task_read', { key: 'NOP-1' }, HAND))).toMatch(/no project NOP/)
  })

  it('serializes simultaneous repeats of one key and keeps different projects separate', async () => {
    const batch = { retry: '', tasks: [{ title: 'One' }] }
    const answers = await Promise.all([call('tasks_create', batch), call('tasks_create', batch)])
    expect(answers).toEqual(['ABC-2 One', 'ABC-2 One'])
    expect(await call('tasks_create', batch, { project: XYZ, task: null })).toBe('XYZ-1 One')
  })

  it('without retry each call creates a new batch and writes no journal', async () => {
    const batch = { tasks: [{ title: 'One' }] }
    expect(await call('tasks_create', batch)).toBe('ABC-2 One')
    expect(await call('tasks_create', batch)).toBe('ABC-3 One')
    expect((await db.query('select * from task_retries')).rows).toEqual([])
  })

  it('stops on a journal failure and names tasks whose progress could not be saved', async () => {
    let broken = 'insert into task_retries'
    tools = new TasksTools({
      ...deps(),
      db: {
        async query<R>(sql: string, params?: unknown[]) {
          if (broken !== '' && (sql.startsWith(broken) || sql.startsWith('delete from task_retries'))) throw new Error('disk unavailable')
          return db.query<R>(sql, params)
        },
      },
    })
    const batch = { retry: 'disk', tasks: [{ title: 'One' }, { title: 'Two' }] }
    expect(await refusal(call('tasks_create', batch))).toBe('disk unavailable')
    expect((await store.list([ABC])).length).toBe(1)
    broken = 'update task_retries set started'
    const unstarted = await refusal(call('tasks_create', batch))
    expect(unstarted).toBe('Nothing was created: retry progress was not saved before task 1: disk unavailable. A repeat with the same retry creates the rest')
    expect((await store.list([ABC])).length).toBe(1)
    broken = 'update task_retries set ids'
    const error = await refusal(call('tasks_create', batch))
    expect(error).toContain('Created ABC-2 One; then retry progress was not saved: disk unavailable')
    expect(error).toContain('A repeat with the same retry finds the unsaved task in the tracker by its marker')
    expect((await store.list([ABC])).map((task) => task.title)).toEqual(['Parent', 'One'])
    expect(refreshed).toEqual([ABC, ABC])
    broken = ''
    expect(await call('tasks_create', batch)).toBe('ABC-2 One (found in the tracker after an interrupted call)\nABC-3 Two')
  })
})

describe('task_update of the description', () => {
  it('patches a piece found exactly once and refuses none or two', async () => {
    expect(await call('task_update', { key: 'ABC-1', replace: [{ old: 'first step', new: 'step one' }] })).toBe('ABC-1: description patched')
    expect(await description(1)).toBe('## Plan\n\nstep one\n\nsecond step\n')
    expect(await refusal(call('task_update', { key: 'ABC-1', replace: [{ old: 'third', new: 'x' }] }))).toMatch(/"old" is not in the description; nothing was changed/)
    expect(await refusal(call('task_update', { key: 'ABC-1', replace: [{ old: 'step', new: 'x' }] }))).toMatch(/found 2 times/)
  })

  it('applies no patch of a batch when one of them fails', async () => {
    const before = await description(1)
    const batch = [{ old: 'first step', new: 'step one' }, { old: 'missing', new: 'x' }]
    expect(await refusal(call('task_update', { key: 'ABC-1', replace: batch }))).toMatch(/not in the description/)
    expect(await description(1)).toBe(before)
  })

  it('a status changed between the read and the edit refuses neither a patch nor a whole description', async () => {
    const rev = Number(/rev (\d+)/.exec(await call('task_read', { key: 'ABC-1' }))![1])
    await store.edit({ project: ABC, number: 1 }, { field: 'status', from: 'Todo', to: 'In Progress' })
    expect(await call('task_update', { key: 'ABC-1', append: '## Notes\n\nmore' })).toBe('ABC-1: description patched')
    expect(await description(1)).toContain('## Notes\n\nmore')
    const after = Number(/rev (\d+)/.exec(await call('task_read', { key: 'ABC-1' }))![1])
    expect(after).toBe(rev + 1)
    expect(await refusal(call('task_update', { key: 'ABC-1', description: 'whole', rev }))).toMatch(/changed meanwhile/)
    expect(await call('task_update', { key: 'ABC-1', description: 'whole', rev: after })).toBe('ABC-1: description replaced')
  })

  it('a repeated patch and append are "already so"', async () => {
    const edit = { key: 'ABC-1', replace: [{ old: 'first step', new: 'first step, done' }], append: '## Notes' }
    expect(await call('task_update', edit)).toBe('ABC-1: description patched')
    expect(await call('task_update', edit)).toBe('ABC-1: already so')
    expect(await description(1)).toBe('## Plan\n\nfirst step, done\n\nsecond step\n\n## Notes')
  })

  it("adds the tracker's note of a text written not as given to the answer", async () => {
    const editor = tracker.editor!
    const note = 'fixed 1 mark: code moved out of bold'
    tracker.editor = {
      ...editor,
      create: async (project, draft, notes) => (notes?.push(note), editor.create(project, draft)),
      patch: async (id, patches, append, notes) => (notes?.push(note), editor.patch(id, patches, append)),
      comment: async (id, body, model, notes) => (notes?.push(note), editor.comment(id, body, model)),
    }
    expect(await call('tasks_create', { tasks: [{ title: 'Core' }, { title: 'Page' }] })).toBe(`ABC-2 Core (${note})\nABC-3 Page (${note})`)
    const edit = { key: 'ABC-1', append: '## Notes', title: 'Plan' }
    expect(await call('task_update', edit)).toBe(`ABC-1: description patched; ${note}; title → Plan`)
    expect(await call('task_comment', { key: 'ABC-1', text: 'Done' })).toBe(`ABC-1: comment added; ${note}`)
  })

  it('a whole description needs rev, and not with patches', async () => {
    expect(await refusal(call('task_update', { key: 'ABC-1', description: 'x' }))).toMatch(/needs "rev"/)
    expect(await refusal(call('task_update', { key: 'ABC-1', description: 'x', rev: 0, append: 'y' }))).toMatch(/not both/)
  })
})

describe('task_update of fields', () => {
  it('changes fields, labels and links in one call and says what changed in a line', async () => {
    await store.create({ project: ABC, title: 'Other' })
    const answer = await call('task_update', { key: 'ABC-2', status: 'backlog', milestone: 'v0.3', labels: { add: ['question'] }, blocks: { add: ['ABC-1'] } })
    expect(answer).toBe('ABC-2: status → Backlog; milestone → v0.3; labels +Question; blocks +ABC-1')
    expect(await call('task_update', { key: 'ABC-2', status: 'Backlog', labels: { add: ['Question'] } })).toBe('ABC-2: already so')
    expect(await call('task_update', { key: 'ABC-2', labels: { remove: ['Question'] }, blocks: { remove: ['ABC-1'] } })).toBe('ABC-2: labels −Question; blocks −ABC-1')
    expect(await call('task_read', { key: 'ABC-1' })).not.toContain('blocked by')
  })

  it('refuses an unknown status and milestone with the lists', async () => {
    expect(await refusal(call('task_update', { key: 'ABC-1', status: 'Later' }))).toMatch(/no status "Later"; the statuses are Backlog, Todo/)
    expect(await refusal(call('task_update', { key: 'ABC-1', milestone: 'v1' }))).toMatch(/the milestones are v0.3. Only the user makes a new one/)
  })
})

describe('the rest', () => {
  it('lists open tasks by default and filters by status, parent and words', async () => {
    await call('tasks_create', { tasks: [{ title: 'Child', parent: 'ABC-1' }, { title: 'Closed', status: 'Done' }] })
    expect(await call('tasks_list', {})).toBe('ABC-1 · Todo · Parent\nABC-2 · Todo · Child')
    expect(await call('tasks_list', { status: ['done'] })).toBe('ABC-3 · Done · Closed')
    expect(await call('tasks_list', { parent: 'abc-1' })).toBe('ABC-2 · Todo · Child')
    expect(await call('tasks_list', { text: 'nothing' })).toBe('No tasks.')
  })

  it('a comment carries the model of the chain session', async () => {
    expect(await call('task_comment', { key: 'ABC-1', text: 'done' })).toBe('ABC-1: comment added')
    const card = await call('task_read', { key: 'ABC-1', comments: true })
    expect(card).toMatch(/## Comments\n\n### .*\(Claude \| opus\)/)
    const [comment] = (await tracker.card!('ABC-1')).comments
    expect(comment!.journal).toMatchObject({ by: 'agent', model: 'Claude | opus' })
  })

  it('task_read puts the replies of a thread under their comment', () => {
    const card: TrackerCard = {
      id: 'ABC-1',
      title: 'Parent',
      description: 'Body',
      status: { name: 'Todo', category: 'ToDo' },
      priority: 'none',
      labels: [],
      milestone: null,
      parent: null,
      blockedBy: [],
      blocks: [],
      related: [],
      comments: [
        { author: 'John Doe', at: Date.UTC(2026, 0, 2, 10, 0), text: 'Which way?', replies: [{ author: 'Jane Roe', at: Date.UTC(2026, 0, 2, 11, 0), text: 'The first.' }] },
        { author: null, at: Date.UTC(2026, 0, 3, 9, 0), text: 'Done.' },
      ],
      attachments: [],
    }
    expect(cardText(card, 1, true)).toContain(
      '## Comments\n\n### John Doe, 2026-01-02 10:00\n\nWhich way?\n\n#### ↳ reply: Jane Roe, 2026-01-02 11:00\n\nThe first.\n\n### Person, 2026-01-03 09:00\n\nDone.',
    )
  })

  it('a comment of a hand session is the agent with no model', async () => {
    await call('task_comment', { key: 'ABC-1', text: 'noted' }, HAND)
    const [comment] = (await tracker.card!('ABC-1')).comments
    expect(comment!.journal).toMatchObject({ by: 'agent', model: null })
  })

  it('task_read lists the attachments by their absolute paths and marks a missing file', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ek-taskmcp-')), 'files')
    tracker = trackerOf(builtinSource(db, PLACES, dir))
    const files = new BuiltinFiles(store, dir, () => {})
    const picture = await files.add({ project: ABC, number: 1 }, { name: 'screen.png', type: 'image/png', bytes: Buffer.alloc(2048) })
    const gone = await files.add({ project: ABC, number: 1 }, { name: 'old.log', type: 'text/plain', bytes: Buffer.from('x') })
    rmSync(join(dir, gone.sha256))
    const card = await call('task_read', { key: 'ABC-1' })
    expect(card).toContain(`## Attachments\n\n- screen.png (2 KB) — ${join(dir, picture.sha256)}\n- old.log (1 B) — file missing`)
  })

  it('has no tool that deletes', async () => {
    expect(toolSpecs(true).map((tool) => tool.name)).toEqual(['tasks_list', 'task_read', 'tasks_create', 'task_update', 'task_comment'])
    expect(toolSpecs(false).find((tool) => tool.name === 'tasks_create')!.inputSchema).toMatchObject({ properties: { project: { type: 'string' } } })
    expect(await refusal(call('task_delete', { key: 'ABC-1' }))).toBe('there is no tool task_delete')
  })
})

describe('the server', () => {
  it('answers initialize, tools/list and a refused call as a tool error', async () => {
    const server = new TasksMcp(deps(), '1.2.3')
    expect(await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, CHAIN)).toMatchObject({
      result: { serverInfo: { name: 'even-keel-tasks', version: '1.2.3' }, capabilities: { tools: {} } },
    })
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, CHAIN)).toBeNull()
    const list = (await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, HAND)) as { result: { tools: unknown[] } }
    expect(list.result.tools).toHaveLength(5)
    expect(await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'task_read', arguments: { key: 'ABC-9' } } }, CHAIN)).toMatchObject({
      result: { isError: true, content: [{ type: 'text', text: expect.stringMatching(/no task ABC-9/) }] },
    })
  })
})
