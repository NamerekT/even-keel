import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { McpAnswer, McpRequest } from '../link/protocol.js'
import type { TaskBrief } from '../tracker/source.js'
import { FILES_META, sentFiles, sessionMetaOf, type CarriedFile } from './carried.js'
import { AWAY_TEXT, KEPT_TEXT, MachineTasks, tasksPathOf, type KeptWrite } from './machine.js'

const SCOPE = { project: 'p1', task: 'ABC-1' }
type Message = Record<string, unknown>

let folder: string
let hubAway: boolean
let asked: { request: McpRequest; message: Message }[]
let kept: KeptWrite[]
let delivered: number
let briefs: Map<string, TaskBrief>
/** What the hub's tasks server answers a call with, given the message it got. */
let hub: (message: Message) => Promise<Message>

const tasks = () => new MachineTasks({
  forward: async (request): Promise<McpAnswer | undefined> => {
    if (hubAway) return undefined
    const message = JSON.parse(request.body!) as Message
    asked.push({ request, message })
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(await hub(message)) }
  },
  keep: async (write) => void kept.push(write),
  delivered: async () => void (delivered += 1),
  folderOf: () => folder,
  attachmentLimit: () => 1024,
  briefOf: (task) => briefs.get(task),
  version: '1.2.3',
  now: () => new Date('2026-11-16T10:00:00Z'),
})
const call = (name: string, args: Message, id = 1): Message => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
const textOf = (reply: Message | null) => ((reply!.result as { content: { text: string }[] }).content[0]!.text)
const text = (value: string) => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: value }] } })

beforeEach(() => {
  folder = join(mkdtempSync(join(tmpdir(), 'ek-machine-tasks-')), 'work')
  mkdirSync(join(folder, '.temp'), { recursive: true })
  hubAway = false
  asked = []
  kept = []
  delivered = 0
  briefs = new Map()
  hub = async () => text('done')
})

describe('the tasks server through the machine (BTN-990)', () => {
  it('sends a call to the hub’s tasks server under the scope’s path and gives back its answer', async () => {
    expect(textOf(await tasks().handle(call('tasks_list', {}), SCOPE))).toBe('done')
    expect(asked[0]!.request).toMatchObject({ path: '/tasks/p1?task=ABC-1', method: 'POST' })
    expect(tasksPathOf({ project: null, task: null })).toBe('/tasks')
  })

  it('reads what a call attaches from the working folder and sends it with the call; the hub never reads the folder', async () => {
    writeFileSync(join(folder, '.temp', 'shot.png'), 'picture')
    hub = async (message) => {
      const meta = sessionMetaOf(message.params as Message)!
      const files = await sentFiles(meta, []).read(['.temp/shot.png'], 1024)
      return text(`attached ${files[0]!.name} of ${Buffer.from(files[0]!.bytes).toString()}`)
    }
    expect(textOf(await tasks().handle(call('task_comment', { key: 'ABC-1', text: 'see', attach: ['.temp/shot.png'] }), SCOPE))).toBe('attached shot.png of picture')
    expect(delivered).toBe(1)
  })

  it('refuses a file outside the folder itself, before the hub is asked', async () => {
    const reply = await tasks().handle(call('task_update', { key: 'ABC-1', attach: ['../secret.txt'] }), SCOPE)
    expect(reply!.result).toMatchObject({ isError: true })
    expect(textOf(reply)).toMatch(/secret\.txt/)
    expect(asked).toEqual([])
  })

  it('writes the files task_read downloaded in the hub into the folder and names their paths', async () => {
    hub = async (message) => {
      const carried: CarriedFile[] = []
      const files = sentFiles(sessionMetaOf(message.params as Message)!, carried)
      const token = await files.downloads!.put('ABC-1', 'mockup.svg', Buffer.from('<svg/>'))
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: `## Attachments\n\n- mockup.svg — ${token}` }], _meta: { [FILES_META]: carried } } }
    }
    const reply = await tasks().handle(call('task_read', { key: 'ABC-1' }), SCOPE)
    const path = join(folder, '.temp', 'task-files', 'ABC-1', 'mockup.svg')
    expect(textOf(reply)).toBe(`## Attachments\n\n- mockup.svg — ${path}`)
    expect(readFileSync(path, 'utf8')).toBe('<svg/>')
    expect(reply!.result).not.toHaveProperty('_meta')
  })

  describe('while the hub is away', () => {
    it('keeps a write in the outbox and says it goes later', async () => {
      writeFileSync(join(folder, 'notes.txt'), 'notes')
      hubAway = true
      expect(textOf(await tasks().handle(call('task_comment', { key: 'ABC-1', text: 'done', attach: ['notes.txt'] }), SCOPE))).toBe(KEPT_TEXT)
      expect(kept).toHaveLength(1)
      expect(kept[0]!.path).toBe('/tasks/p1?task=ABC-1')
      // The file is read now: the write goes with it whatever happens to the folder before the hub is back.
      expect(sessionMetaOf(kept[0]!.message.params as Message)!.attach['notes.txt']).toMatchObject({ name: 'notes.txt' })
    })

    it('answers a read of the session’s own task from the last read, otherwise from the launch’s brief', async () => {
      const machine = tasks()
      hubAway = true
      expect(textOf(await machine.handle(call('task_read', { key: 'ABC-1' }), SCOPE))).toBe(AWAY_TEXT)
      briefs.set('ABC-1', { title: 'Example task', description: 'Do the thing.' })
      expect(textOf(await machine.handle(call('task_read', { key: 'abc-1' }), SCOPE))).toMatch(/as its session was started with[^]*# ABC-1 Example task\n\nDo the thing\.$/)
      hubAway = false
      hub = async () => text('# ABC-1 Example task\n\nThe card.')
      await machine.handle(call('task_read', { key: 'ABC-1' }), SCOPE)
      hubAway = true
      expect(textOf(await machine.handle(call('task_read', { key: 'ABC-1' }), SCOPE))).toMatch(/as this machine read it at 2026-11-16T10:00:00\.000Z[^]*The card\.$/)
    })

    it('refuses a read of another task and any other tool, and keeps nothing', async () => {
      hubAway = true
      const other = await tasks().handle(call('task_read', { key: 'ABC-2' }), SCOPE)
      expect(other!.result).toMatchObject({ isError: true })
      expect(textOf(other)).toBe(AWAY_TEXT)
      expect(textOf(await tasks().handle(call('tasks_list', {}), SCOPE))).toBe(AWAY_TEXT)
      expect(kept).toEqual([])
    })

    it('still answers the handshake and the tools list, the hub’s last one when it gave one', async () => {
      const machine = tasks()
      hub = async () => ({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'from-hub' }] } })
      await machine.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, SCOPE)
      hubAway = true
      expect(await machine.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, SCOPE)).toMatchObject({ result: { serverInfo: { name: 'even-keel-tasks', version: '1.2.3' } } })
      expect(await machine.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, SCOPE)).toMatchObject({ result: { tools: [{ name: 'from-hub' }] } })
      const fresh = (await tasks().handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, SCOPE)) as { result: { tools: { name: string }[] } }
      expect(fresh.result.tools.map((tool) => tool.name)).toContain('task_comment')
      expect(await machine.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, SCOPE)).toBeNull()
    })
  })

  it('without a folder sends no files: the hub says the folder is not known', async () => {
    folder = null as unknown as string
    const machine = new MachineTasks({
      forward: async (request) => {
        asked.push({ request, message: JSON.parse(request.body!) as Message })
        return { status: 200, headers: {}, body: JSON.stringify(text('no folder')) }
      },
      keep: async () => {},
      delivered: async () => {},
      folderOf: () => null,
      attachmentLimit: () => 1024,
      briefOf: () => undefined,
      version: '1',
    })
    await machine.handle(call('task_update', { key: 'ABC-1', attach: ['x.txt'] }), SCOPE)
    expect(sessionMetaOf(asked[0]!.message.params as Message)).toBeUndefined()
    expect(existsSync(join(tmpdir(), 'x.txt'))).toBe(false)
  })
})
