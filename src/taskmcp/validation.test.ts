import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RULES } from '../chain/rules.js'
import type { Queryable } from '../storage/database.js'
import { EditRefused } from '../tracker/editor.js'
import type { Tracker } from '../tracker/source.js'
import { TasksTools, type TasksScope } from './calls.js'
import { TasksMcp } from './server.js'
import { toolSpecs } from './tools.js'

const CHAIN: TasksScope = { project: 'project-id', task: 'ABC-1' }
const HAND: TasksScope = { project: null, task: null }
const reader = { id: 'project-id', project: 'project-id', prefix: 'ABC' }
const query = vi.fn()
const list = vi.fn(async () => [])
const run = vi.fn(async <T>(_reader: string, call: (tracker: Tracker) => Promise<T>): Promise<T> => call({ editor: { list } } as unknown as Tracker))
const deps = {
  db: { query } as unknown as Queryable,
  run,
  readers: () => [reader],
  readerOfPrefix: () => reader,
  rulesOf: () => DEFAULT_RULES,
  modelOf: () => null,
  runOf: () => undefined,
  setRun: () => {},
  refresh: vi.fn(async () => {}),
  folderOf: () => null,
  attachmentLimit: () => 1024,
  editedOf: () => undefined,
}
let tools: TasksTools

beforeEach(() => {
  vi.clearAllMocks()
  tools = new TasksTools(deps)
})

describe('task argument schemas', () => {
  it('requires project only for unscoped list and create calls', () => {
    for (const withProject of [false, true]) {
      const specs = toolSpecs(withProject)
      expect(specs.find((tool) => tool.name === 'tasks_list')!.inputSchema.required ?? []).toEqual(withProject ? [] : ['project'])
      expect(specs.find((tool) => tool.name === 'tasks_create')!.inputSchema.required).toEqual(withProject ? ['tasks'] : ['project', 'tasks'])
    }
  })

  it('keeps the runtime refusal for clients that omit project', async () => {
    for (const [name, args] of [['tasks_list', {}], ['tasks_create', { tasks: [{ title: 'A' }] }]] as const) {
      await expect(tools.call(name, args, HAND)).rejects.toThrow('"project" is required: the key of the project, as in its task keys')
    }
    expect(run).not.toHaveBeenCalled()
  })
})

describe('unknown task arguments', () => {
  it.each([
    ['tasks_list', {}],
    ['task_read', { key: 'ABC-1' }],
    ['tasks_create', { tasks: [{ title: 'A' }], retry: 'refused-batch' }],
    ['task_update', { key: 'ABC-1', title: 'A' }],
    ['task_comment', { key: 'ABC-1', text: 'A' }],
  ])('refuses every unknown top-level key of %s before any I/O', async (name, args) => {
    const parameters = Object.keys(toolSpecs(false).find((tool) => tool.name === name)!.inputSchema.properties as object).join(', ')
    await expect(tools.call(name, { ...args, query: 'A', owner: 'B' }, CHAIN)).rejects.toThrow(
      `"query", "owner" are not parameters of ${name}; its parameters are ${parameters}`,
    )
    expect(run).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
    expect(deps.refresh).not.toHaveBeenCalled()
  })

  it('names the extra field and all parameters in schema order', async () => {
    await expect(tools.call('tasks_list', { query: 'A' }, HAND)).rejects.toThrow(
      '"query" is not a parameter of tasks_list; its parameters are project, tracker, status, milestone, label, parent, text',
    )
  })

  it('checks every task before reading the tracker or saving retry', async () => {
    await expect(tools.call('tasks_create', { tasks: [{ title: 'A' }, { title: 'B', owner: 'C' }], retry: 'batch' }, CHAIN)).rejects.toThrow(
      'tasks #2: "owner" is not a field of a task; its fields are title, description, status, priority, milestone, labels, estimate, run, parent, blocks, blockedBy, relates, component, attach',
    )
    expect(run).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('checks every replacement before any read or write', async () => {
    await expect(tools.call('task_update', { key: 'ABC-1', replace: [{ old: 'A', new: 'B' }, { old: 'B', new: 'C', query: 'D' }] }, CHAIN)).rejects.toThrow(
      'replace #2: "query" is not a field of a replacement; its fields are old, new',
    )
    expect(run).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('checks replacement fields in the accepted single-object form too', async () => {
    await expect(tools.call('task_update', { key: 'ABC-1', replace: { old: 'A', new: 'B', owner: 'C' } }, CHAIN)).rejects.toThrow(
      'replace #1: "owner" is not a field of a replacement; its fields are old, new',
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses an unknown name even when its value is missing', async () => {
    await expect(tools.call('tasks_list', { query: undefined }, CHAIN)).rejects.toBeInstanceOf(EditRefused)
    expect(run).not.toHaveBeenCalled()
  })

  it('keeps project accepted and ignored in a scoped call', async () => {
    await expect(tools.call('tasks_list', { project: 'OTHER' }, CHAIN)).resolves.toBe('No tasks.')
    expect(run).toHaveBeenCalledWith(reader.id, expect.any(Function))
  })

  it('keeps capability refusals for fields hidden from the session schema', async () => {
    expect(toolSpecs(true, { components: false, attachments: false }).find((tool) => tool.name === 'task_update')!.inputSchema.properties).not.toHaveProperty('component')
    for (const [args, message] of [
      [{ component: 'Server' }, 'ABC has no components; send the task without one, or name the area with a label'],
      [{ attach: ['sample.txt'] }, 'ABC takes no attachments through these tools; name the file in the text instead'],
    ] as const) {
      await expect(tools.call('task_update', { key: 'ABC-1', ...args }, CHAIN)).rejects.toThrow(message)
    }
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('returns an MCP tool error for unknown arguments', async () => {
    const server = new TasksMcp(deps, 'test')
    const answer = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tasks_list', arguments: { query: 'A' } } }, HAND)
    expect(answer).toMatchObject({ result: { isError: true, content: [{ type: 'text', text: expect.stringContaining('"query" is not a parameter of tasks_list') }] } })
    expect(run).not.toHaveBeenCalled()
  })
})
