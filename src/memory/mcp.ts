import { CLAUDE } from '../claude/name.js'
import type { TasksScope } from '../taskmcp/calls.js'
import type { ToolSpec } from '../taskmcp/tools.js'
import { folderRecord, folderRecords, removeRecord, writeRecord } from './files.js'
import type { MemoryHub } from './git/hub.js'
import { indexLine, MEMORY_NAME, MEMORY_TYPES, similarRecords, type MemoryFact, type MemoryRecord } from './record.js'

/** The memory server of the built-in `agent-bridge` plugin (BTN-1029): its name in the plugin's `.mcp.json`. */
export const MEMORY_SERVER = 'memory'
/** The gateway's path of the server: a package route whose entry is a local address with this path. */
export const MEMORY_PATH = '/memory'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

/**
 * Claude Code loads the project's memory folder itself (`autoMemoryDirectory`, BTN-1647): its sessions get neither the
 * memory server nor the index in the prompt. Every other agent works the memory through the server.
 */
export function readsFileMemory(agent: string): boolean {
  return agent === CLAUDE
}

/** A server entry whose address is the gateway's own memory server (the `agent-bridge` plugin's `.mcp.json`). */
export function isMemoryUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    return LOCAL_HOSTS.has(parsed.hostname) && parsed.pathname === MEMORY_PATH
  } catch {
    return false
  }
}

export interface MemoryDeps {
  /** The project's working copy on the hub, whose files are the records. */
  hub: Pick<MemoryHub, 'within'>
}

/** What a versioned write met when it was refused: a live record of the name, or the record as it is now. */
type Refusal = { kind: 'exists'; current: MemoryRecord } | { kind: 'changed'; current: MemoryRecord | undefined }

type Message = Record<string, unknown>

class Refused extends Error {}

const nameField = { type: 'string', description: 'the record\'s name: lowercase kebab-case, also its file name, e.g. "tests-need-docker"' }
const versionField = { type: 'integer', minimum: 1, description: 'the version memory_read gave for the record' }

export const MEMORY_TOOLS: ToolSpec[] = [
  {
    name: 'memory_list',
    description: "The project's memory index: each record's name, version and description. The prompt has it as of the session's start.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'memory_read',
    description: 'Records of the project memory, whole, each with its version: read a record before changing or deleting it.',
    inputSchema: {
      type: 'object',
      properties: { names: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'names from the index' } },
      required: ['names'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_write',
    description:
      'Keeps one fact in the project memory, shared by every session of the project on every machine. Without version — a new record; with the version memory_read gave — a change of that record. If someone changed it since, the change is refused with its current text and version: apply yours to it and write again.',
    inputSchema: {
      type: 'object',
      properties: {
        name: nameField,
        description: { type: 'string', description: 'one line: what the fact is about, as the index shows it' },
        type: { type: 'string', enum: [...MEMORY_TYPES], description: 'user — who the user is; feedback — how to work; project — the project\'s state and constraints; reference — where to find things' },
        body: { type: 'string', description: 'the fact; for feedback and project, with Why: and How to apply: lines' },
        version: versionField,
        distinct: { type: 'boolean', description: 'true — a new record even though similar ones exist (the refusal lists them)' },
      },
      required: ['name', 'description', 'type', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_delete',
    description: 'Deletes a record that turned out wrong or no longer holds; refused when someone changed it since you read it.',
    inputSchema: {
      type: 'object',
      properties: { name: nameField, version: versionField },
      required: ['name', 'version'],
      additionalProperties: false,
    },
  },
]

/**
 * Even Keel's memory MCP server (BTN-1029, `docs/sessions/memory.md`), answered in the hub's gateway: the records are
 * the files of the project's working copy on the hub (BTN-1646), written with the version the session read and
 * committed at once. It serves agents without Claude Code's file memory (BTN-1647).
 */
export class MemoryMcp {
  constructor(
    private readonly deps: MemoryDeps,
    private readonly version: string,
  ) {}

  /** The reply to one JSON-RPC message; `null` for a notification or a reply of the client. */
  async handle(message: Message, scope: TasksScope): Promise<Message | null> {
    const { id, method } = message
    if (id === undefined || id === null || typeof method !== 'string') return null
    const params = typeof message.params === 'object' && message.params !== null ? (message.params as Message) : {}
    const result = (value: unknown): Message => ({ jsonrpc: '2.0', id, result: value })
    switch (method) {
      case 'initialize':
        return result({
          protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'even-keel-memory', version: this.version },
        })
      case 'ping':
        return result({})
      case 'tools/list':
        return result({ tools: MEMORY_TOOLS })
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : ''
        const args = typeof params.arguments === 'object' && params.arguments !== null ? (params.arguments as Message) : {}
        try {
          return result({ content: [{ type: 'text', text: await this.call(name, args, scope) }] })
        } catch (error) {
          if (!(error instanceof Refused)) throw error
          return result({ content: [{ type: 'text', text: error.message }], isError: true })
        }
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
    }
  }

  /** The text of a call; a refusal the session can act on throws `Refused`. */
  async call(name: string, args: Message, scope: TasksScope): Promise<string> {
    const project = scope.project
    if (project === null) throw new Refused("the memory server serves a project's sessions: its address names no project")
    const inFolder = <T>(step: (folder: string) => T, wrote = false) =>
      this.deps.hub.within(project, (folder) => {
        if (folder === null) throw new Refused('the hub keeps no memory folder for this project: it has no folder Even Keel knows')
        return step(folder)
      }, wrote)
    switch (name) {
      case 'memory_list':
        return inFolder((folder) => {
          const records = folderRecords(folder)
          if (records.length === 0) return 'The project memory is empty.'
          return records.map((record) => `${indexLine(record)} (v${record.version})`).join('\n')
        })
      case 'memory_read': {
        const names = args.names
        if (!Array.isArray(names) || names.length === 0 || names.some((each) => typeof each !== 'string')) throw new Refused('names must be a list of record names')
        return inFolder((folder) => (names as string[]).map((each) => {
          const record = folderRecord(folder, each)
          return record === undefined ? `## ${each}\nThere is no such record.` : recordText(record)
        }).join('\n\n'))
      }
      case 'memory_write':
        return this.write(args, inFolder)
      case 'memory_delete': {
        const record = stringOf(args, 'name')
        const version = versionOf(args, true)!
        return inFolder((folder) => {
          const current = folderRecord(folder, record)
          if (current?.version !== version) throw new Refused(refusal(record, { kind: 'changed', current }))
          removeRecord(folder, current.file)
          return `Deleted ${record}.`
        }, true)
      }
      default:
        throw new Refused(`there is no tool ${name}`)
    }
  }

  private write(args: Message, inFolder: <T>(step: (folder: string) => T, wrote?: boolean) => Promise<T>): Promise<string> {
    const fact: MemoryFact = { name: stringOf(args, 'name'), description: stringOf(args, 'description'), type: stringOf(args, 'type'), body: stringOf(args, 'body', true) }
    if (!MEMORY_NAME.test(fact.name)) throw new Refused(`name ${JSON.stringify(fact.name)} must be lowercase letters, digits, dots, dashes and underscores, 80 characters at most`)
    if (!(MEMORY_TYPES as readonly string[]).includes(fact.type)) throw new Refused(`type must be one of ${MEMORY_TYPES.join(', ')}`)
    const version = versionOf(args, false)
    return inFolder((folder) => {
      const records = folderRecords(folder)
      const current = records.find((each) => each.name === fact.name)
      if (version === undefined) {
        if (current !== undefined) throw new Refused(refusal(fact.name, { kind: 'exists', current }))
        const similar = args.distinct === true ? [] : similarRecords(fact, records)
        if (similar.length > 0) {
          throw new Refused(
            `Not kept yet: these records look like the same fact:\n${similar.map((each) => `${indexLine(each)} (v${each.version})`).join('\n')}\n` +
              `Change one of them instead (memory_read, then memory_write with its version), or repeat this call with distinct: true to keep ${fact.name} as a new record.`,
          )
        }
      } else if (current?.version !== version) throw new Refused(refusal(fact.name, { kind: 'changed', current }))
      const kept = writeRecord(folder, fact, current?.file)
      return `Kept ${fact.name}, version ${kept.version}.`
    }, true)
  }
}

function refusal(name: string, outcome: Refusal): string {
  const current = outcome.current
  if (outcome.kind === 'exists') {
    return `Not kept: ${name} already exists. To change it, apply your change to its text below and write again with version ${current!.version}; to keep both, choose another name.\n\n${recordText(current!)}`
  }
  if (current === undefined) return `Not kept: there is no record ${name}: it was deleted, or never written. To add it, write it without a version.`
  return `Not kept: ${name} changed since you read it. Its current text, version ${current.version}, is below: apply your change to it and repeat the call with version ${current.version}.\n\n${recordText(current)}`
}

function recordText(record: MemoryRecord): string {
  return `## ${record.name} (version ${record.version}, ${record.type})\ndescription: ${record.description}\n\n${record.body}`
}

function stringOf(args: Message, field: string, empty = false): string {
  const value = args[field]
  if (typeof value !== 'string' || (!empty && value.trim() === '')) throw new Refused(`${field} must be ${empty ? 'a string' : 'a non-empty string'}`)
  return empty ? value : value.trim()
}

function versionOf(args: Message, required: boolean): number | undefined {
  const value = typeof args.version === 'string' && /^\d+$/.test(args.version) ? Number(args.version) : args.version
  if (value === undefined && !required) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Refused('version must be the record\'s version from memory_read, a whole number from 1')
  return value
}
