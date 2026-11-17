import type { McpAnswer, McpRequest } from '../link/protocol.js'
import type { TaskBrief } from '../tracker/source.js'
import type { TaskUpload } from '../tracker/editor.js'
import { refusalText, type TasksScope } from './calls.js'
import { FILES_META, SESSION_META, sentFile, type CarriedFile, type NoteWriter, type SentFile } from './carried.js'
import { copiesOf, folderSink } from './downloads.js'
import { readUploads } from './files.js'
import { TASKS_PATH } from './server.js'
import { HANDOFF_TOOL, toolSpecs } from './tools.js'

type Message = Record<string, unknown>

/** The calls the machine keeps for the hub while it is away: they change the tracker and need no answer to go on. */
export const KEPT_WRITES: ReadonlySet<string> = new Set(['task_comment', 'task_update', 'tasks_create', HANDOFF_TOOL])

/** The machine's event of a kept write: the hub makes it on its tasks server once it takes the event. */
export const KEPT_WRITE_EVENT = 'tasks.write'

/** A write kept in the machine's outbox (`KEPT_WRITE_EVENT`): the path of the tasks server and the request, its files read. */
export interface KeptWrite {
  path: string
  message: Message
}

export const KEPT_TEXT = "Even Keel's hub is unreachable right now: this call is kept on the machine and goes to the tracker once the hub is back. Do not repeat it."
export const KEPT_NOTE_TEXT =
  "Even Keel's hub is unreachable right now: the note is kept on this machine and reaches the hub once it is back. Do not repeat the call; end your turn with a last line CHECKPOINT: alone."
export const AWAY_TEXT = "Even Keel's hub is unreachable right now, and this server works through it: try again later."

export interface MachineTasksDeps {
  /** The hub's answer to a request of its tasks server; `undefined` — the hub is unreachable now. */
  forward(request: McpRequest): Promise<McpAnswer | undefined>
  /** Keeps a write in the machine's outbox, for the hub to make once it is back. */
  keep(write: KeptWrite): Promise<void>
  /** Resolves once what the outbox held went to the hub: a write never overtakes the ones kept before it. */
  delivered(): Promise<void>
  /**
   * The session's working folder: a chain session's worktree, otherwise the repository of the project of the call —
   * the address's, or by `named`, the project key or task key the call gives; `null` — not known.
   */
  folderOf(scope: TasksScope, named: string | null): string | null
  attachmentLimit(): number
  /** The text of the task as the hub put it into its launch (`brief: true`). */
  briefOf(task: string): TaskBrief | undefined
  /**
   * The task's live session on this machine with its branch, as `handoff_write` names its writer (BTN-1046); the time
   * is the call's, so a write kept while the hub is away is judged by the session of then; `undefined` — none.
   */
  writerOf?(task: string): Omit<NoteWriter, 'at'> | undefined
  version: string
  now?: () => Date
}

/** A task read through the machine, as it was then: the answer to the same read while the hub is away. */
interface Read {
  at: Date
  text: string
}

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

const isObject = (value: unknown): value is Message => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The path of the hub's tasks server for a call of this scope. */
export function tasksPathOf(scope: TasksScope): string {
  const project = scope.project === null ? '' : `/${encodeURIComponent(scope.project)}`
  return `${TASKS_PATH}${project}${scope.task === null ? '' : `?task=${encodeURIComponent(scope.task)}`}`
}

/**
 * The tasks server as the machine's gateway answers it (BTN-990): every call goes to the hub's tasks server over the
 * machine's connection. The working folder is the machine's: the gateway reads what a call attaches and writes what
 * `task_read` downloaded. While the hub is away a write is kept in the outbox and goes later, a read of the session's
 * own task is answered from what the machine has of it, anything else says the hub is unreachable.
 */
export class MachineTasks {
  private readonly lists = new Map<string, unknown>()
  private readonly reads = new Map<string, Read>()

  constructor(private readonly deps: MachineTasksDeps) {}

  async handle(message: Message, scope: TasksScope): Promise<Message | null> {
    const { id } = message
    const answered = id !== undefined && id !== null
    const tool = message.method === 'tools/call' ? toolOf(message) : undefined
    const folder = tool === undefined ? null : this.deps.folderOf(scope, namedOf(tool.args))
    let sent = message
    if (tool !== undefined) {
      try {
        sent = await this.withFiles(message, tool, folder)
        if (tool.name === HANDOFF_TOOL) sent = this.withWriter(sent, scope)
      } catch (error) {
        return answered ? toolError(id, refusalText(error)) : null
      }
      if (KEPT_WRITES.has(tool.name)) await this.deps.delivered()
    }
    const path = tasksPathOf(scope)
    const answer = await this.deps.forward({ path, method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(sent) })
    if (answer === undefined) return this.away(sent, scope, path)
    if (!answered || answer.status === 202 || answer.body === '') return null
    let reply: unknown
    try {
      reply = JSON.parse(answer.body)
    } catch {
      reply = undefined
    }
    if (answer.status !== 200 || !isObject(reply)) return { jsonrpc: '2.0', id, error: { code: -32603, message: `Even Keel's hub answered ${answer.status}` } }
    return this.settled(reply, message, scope, path, folder)
  }

  /** The files the call attaches, read from the folder and sent in its `_meta`; without a folder the hub refuses them. */
  private async withFiles(message: Message, tool: { name: string; args: Message }, folder: string | null): Promise<Message> {
    if (folder === null) return message
    const lists = tool.name === 'tasks_create' && Array.isArray(tool.args.tasks) ? tool.args.tasks.map((each) => (isObject(each) ? pathsOf(each.attach) : [])) : [pathsOf(tool.args.attach)]
    const attach: Record<string, SentFile> = {}
    for (const paths of lists) {
      if (paths.length === 0) continue
      const files: TaskUpload[] = await readUploads(paths, folder, this.deps.attachmentLimit())
      for (const [index, path] of paths.entries()) attach[path.trim()] = sentFile(files[index]!)
    }
    const copies = tool.name === 'task_read' && typeof tool.args.key === 'string' ? await copiesOf(folder, tool.args.key) : {}
    const params = isObject(message.params) ? message.params : {}
    const meta = isObject(params._meta) ? params._meta : {}
    return { ...message, params: { ...params, _meta: { ...meta, [SESSION_META]: { attach, downloads: true, copies } } } }
  }

  /** The note's writer in the call's `_meta`: the task's session on this machine now; without one the hub refuses the note. */
  private withWriter(message: Message, scope: TasksScope): Message {
    const writer = scope.task === null ? undefined : this.deps.writerOf?.(scope.task)
    if (writer === undefined) return message
    const params = isObject(message.params) ? message.params : {}
    const meta = isObject(params._meta) ? params._meta : {}
    const session = isObject(meta[SESSION_META]) ? meta[SESSION_META] : { attach: {}, downloads: false, copies: {} }
    const stamped: NoteWriter = { ...writer, at: this.now().toISOString() }
    return { ...message, params: { ...params, _meta: { ...meta, [SESSION_META]: { ...session, writer: stamped } } } }
  }

  /** The hub's reply with the downloaded files written into the folder and their paths in the text. */
  private async settled(reply: Message, asked: Message, scope: TasksScope, path: string, folder: string | null): Promise<Message> {
    const result = isObject(reply.result) ? reply.result : undefined
    if (result === undefined) return reply
    if (asked.method === 'tools/list') this.lists.set(path, result)
    const meta = isObject(result._meta) ? result._meta : undefined
    const carried = Array.isArray(meta?.[FILES_META]) ? (meta[FILES_META] as CarriedFile[]) : []
    let settled = result
    if (carried.length > 0) {
      const paths = await Promise.all(carried.map(async (file) => {
        if (folder === null) return 'not downloaded'
        const sink = folderSink(folder)
        if (file.data === undefined) return (await sink.existing(file.key, file.name, file.size ?? -1)) ?? 'file unavailable'
        return sink.put(file.key, file.name, Buffer.from(file.data, 'base64')).catch(() => 'file unavailable')
      }))
      const { [FILES_META]: _, ...rest } = meta!
      const swapped = (text: string) => carried.reduce((each, file, index) => each.split(file.token).join(paths[index]!), text)
      settled = { ...result, content: contentOf(result).map((part) => (typeof part.text === 'string' ? { ...part, text: swapped(part.text) } : part)) }
      if (Object.keys(rest).length === 0) delete settled._meta
      else settled._meta = rest
    }
    const tool = toolOf(asked)
    const own = ownTask(tool, scope)
    if (own !== undefined && settled.isError !== true) {
      const text = contentOf(settled).map((part) => part.text).filter((each) => typeof each === 'string').join('\n')
      this.reads.set(own, { at: this.now(), text })
    }
    return { ...reply, result: settled }
  }

  /** The answer while the hub is away. */
  private async away(message: Message, scope: TasksScope, path: string): Promise<Message | null> {
    const { id, method } = message
    if (id === undefined || id === null) return null
    const result = (value: unknown): Message => ({ jsonrpc: '2.0', id, result: value })
    if (method === 'initialize') {
      const params = isObject(message.params) ? message.params : {}
      return result({
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'even-keel-tasks', version: this.deps.version },
      })
    }
    if (method === 'ping') return result({})
    if (method === 'tools/list') return result(this.lists.get(path) ?? { tools: toolSpecs(scope.project !== null) })
    if (method !== 'tools/call') return { jsonrpc: '2.0', id, error: { code: -32000, message: AWAY_TEXT } }
    const tool = toolOf(message)!
    if (KEPT_WRITES.has(tool.name)) {
      await this.deps.keep({ path, message })
      return result({ content: [{ type: 'text', text: tool.name === HANDOFF_TOOL ? KEPT_NOTE_TEXT : KEPT_TEXT }] })
    }
    const own = ownTask(tool, scope)
    const text = own === undefined ? undefined : this.ownText(own)
    return text === undefined ? toolError(id, AWAY_TEXT) : result({ content: [{ type: 'text', text }] })
  }

  /** The session's own task while the hub is away: as the machine last read it, otherwise as its launch brought it. */
  private ownText(key: string): string | undefined {
    const read = this.reads.get(key)
    if (read !== undefined) return `Even Keel's hub is unreachable right now: this is ${key} as this machine read it at ${read.at.toISOString()}; it may have changed since.\n\n${read.text}`
    const brief = this.deps.briefOf(key)
    if (brief === undefined) return undefined
    const description = brief.description.trim()
    return `Even Keel's hub is unreachable right now: this is ${key} as its session was started with, without its comments and links.\n\n# ${key} ${brief.title.trim()}${description === '' ? '' : `\n\n${description}`}`
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }
}

function toolOf(message: Message): { name: string; args: Message } | undefined {
  const params = isObject(message.params) ? message.params : {}
  if (typeof params.name !== 'string') return undefined
  return { name: params.name, args: isObject(params.arguments) ? params.arguments : {} }
}

/** The key of the session's own task when the call reads it. */
function ownTask(tool: { name: string; args: Message } | undefined, scope: TasksScope): string | undefined {
  if (tool?.name !== 'task_read' || scope.task === null || typeof tool.args.key !== 'string') return undefined
  const key = tool.args.key.trim().toUpperCase()
  return key === scope.task.toUpperCase() ? key : undefined
}

/** The project key or task key a call names, by which a session started by hand finds its folder. */
function namedOf(args: Message): string | null {
  for (const value of [args.project, args.key]) if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return null
}

function pathsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : []
}

function contentOf(result: Message): Message[] {
  return Array.isArray(result.content) ? result.content.filter(isObject) : []
}

function toolError(id: unknown, text: string): Message {
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } }
}
