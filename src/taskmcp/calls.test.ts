import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { builtinSource } from '../builtin/source.js'
import { BuiltinStore } from '../builtin/store.js'
import { openDatabase } from '../storage/database.js'
import { trackerOf, type Tracker } from '../tracker/source.js'
import { TasksTools, type TasksScope } from './calls.js'
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
  await db.exec('truncate builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_task_labels, builtin_relations, builtin_comments')
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
    expect(await call('tasks_create', batch)).toBe(first)
    expect((await store.list([ABC])).map((task) => task.title)).toEqual(['Parent', 'One', 'Two'])
  })

  it('a hand session names the project by its key', async () => {
    expect(await refusal(call('tasks_create', { tasks: [{ title: 'A' }] }, HAND))).toMatch(/"project" is required/)
    expect(await call('tasks_create', { project: 'xyz', tasks: [{ title: 'There' }] }, HAND)).toBe('XYZ-1 There')
    expect(await call('tasks_list', { project: 'XYZ' }, HAND)).toBe('XYZ-1 · Todo · There')
    expect(await call('task_read', { key: 'XYZ-1' }, HAND)).toContain('# XYZ-1 There')
    expect(await refusal(call('task_read', { key: 'NOP-1' }, HAND))).toMatch(/no project NOP/)
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

  it('a comment of a hand session is the agent with no model', async () => {
    await call('task_comment', { key: 'ABC-1', text: 'noted' }, HAND)
    const [comment] = (await tracker.card!('ABC-1')).comments
    expect(comment!.journal).toMatchObject({ by: 'agent', model: null })
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
