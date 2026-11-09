import type { TrackerAdapter } from '../tracker/source.js'
import { refusalText, TasksTools, type TasksDeps, type TasksScope } from './calls.js'
import { toolSpecs } from './tools.js'

/** The server's name in a session: its tools are `mcp__plugin_tasks_tasks__*` in the `tasks` plugin. */
export const TASKS_SERVER = 'tasks'

/** The server serves the tracker's projects: its own server is this one, or its source edits tasks (BTN-779). */
export function servesTasks(adapter: TrackerAdapter | undefined): boolean {
  return adapter !== undefined && (adapter.mcpServer === TASKS_SERVER || adapter.editsTasks === true)
}
/** The gateway's path of the server; `/tasks/<project id>` names the project. */
export const TASKS_PATH = '/tasks'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** A server entry whose address is the gateway's own tasks server (the `tasks` plugin's `.mcp.json`). */
export function isTasksUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    return LOCAL_HOSTS.has(parsed.hostname) && (parsed.pathname === TASKS_PATH || parsed.pathname.startsWith(`${TASKS_PATH}/`))
  } catch {
    return false
  }
}

/** The project of a path of the tasks server: `null` — `/tasks` alone; `undefined` — not its path. */
export function tasksProjectOf(path: string): string | null | undefined {
  if (path === TASKS_PATH || path === `${TASKS_PATH}/`) return null
  const match = /^\/tasks\/([^/]+)\/?$/.exec(path)
  if (match === null) return undefined
  try {
    return decodeURIComponent(match[1]!)
  } catch {
    return undefined
  }
}

type Message = Record<string, unknown>

/**
 * Even Keel's tasks MCP server (BTN-768), served in the service by the gateway over the Streamable HTTP transport with
 * JSON replies: one handler for every session, a call's project and task from its address.
 */
export class TasksMcp {
  private readonly tools: TasksTools

  constructor(
    deps: TasksDeps,
    private readonly version: string,
  ) {
    this.tools = new TasksTools(deps)
  }

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
          serverInfo: { name: 'even-keel-tasks', version: this.version },
        })
      case 'ping':
        return result({})
      case 'tools/list':
        return result({ tools: toolSpecs(scope.project !== null, await this.tools.fields(scope)) })
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : ''
        const args = typeof params.arguments === 'object' && params.arguments !== null ? (params.arguments as Message) : {}
        try {
          return result({ content: [{ type: 'text', text: await this.tools.call(name, args, scope) }] })
        } catch (error) {
          return result({ content: [{ type: 'text', text: refusalText(error) }], isError: true })
        }
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
    }
  }
}
