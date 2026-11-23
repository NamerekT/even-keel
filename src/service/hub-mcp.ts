import { idPrefixOf, ownerOf } from '../config.js'
import { errorReason } from '../error-reason.js'
import type { McpAnswer, McpRequest } from '../link/protocol.js'
import type { MachineEnd } from '../link/machine.js'
import { root } from '../locations.js'
import { placedIn } from '../machine/assignments.js'
import { parseRoute } from '../packages/launch.js'
import type { TasksScope } from '../taskmcp/calls.js'
import { MACHINE_HEADER, type NoteWriter } from '../taskmcp/carried.js'
import { KEPT_WRITE_EVENT, MachineTasks, type KeptWrite } from '../taskmcp/machine.js'
import { tasksProjectOf } from '../taskmcp/server.js'
import type { Queryable } from '../storage/database.js'
import { installed } from '../updates/watcher.js'
import type { MachineContext } from './machine-context.js'

const RELAY_TIMEOUT_MS = 10 * 60_000
const FORWARD = ['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']
const BACK = ['content-type', 'mcp-session-id']

export interface HubMcpDeps {
  db: Queryable
  /** The hub's gateway; `undefined` — it does not listen (yet). */
  origin(): string | undefined
  /** The hub's own machine. */
  own(): string
  /** Every project of the hub, by id. */
  projects(): string[]
  log: (line: string) => void
}

const answerOf = (status: number): McpAnswer => ({ status, headers: {}, body: '' })

/**
 * The hub's side of the MCP servers a machine's gateway carries (BTN-990): a machine asks only the servers of the
 * projects it is briefed, and `/tasks` with no project only when it is briefed every project. That is every project of
 * the hub for the own machine and, for a machine elsewhere, each one with its row in the pool, turned on or off: a
 * machine turned off keeps the project in its brief, installs and probes its packages and finishes the task it holds
 * (BTN-1517).
 */
export class HubMcp {
  /**
   * Machine and project of each refusal already logged: a machine taken out of a pool asks its servers until its next
   * brief (BTN-1325). Forgotten once the machine is admitted there again.
   */
  private readonly refused = new Set<string>()

  constructor(private readonly deps: HubMcpDeps) {}

  /** May the machine ask this path of the hub's gateway? */
  async admits(machine: string, path: string): Promise<boolean> {
    return (await this.scopeOf(machine, path)).admitted
  }

  /** The project the path names (`*` for every one, the path itself for none) and whether the machine may ask it. */
  private async scopeOf(machine: string, path: string): Promise<{ scope: string; admitted: boolean }> {
    const pathname = new URL(path, 'http://hub').pathname
    const tasks = tasksProjectOf(pathname)
    const project = tasks !== undefined ? tasks : parseRoute(pathname)?.project
    if (project === undefined) return { scope: pathname, admitted: false }
    const scope = project ?? '*'
    const projects = this.deps.projects()
    if (machine === this.deps.own()) return { scope, admitted: project === null || projects.includes(project) }
    for (const each of project === null ? projects : [project]) {
      if (!(await placedIn(this.deps.db, each, machine))) return { scope, admitted: false }
    }
    return { scope, admitted: true }
  }

  /** The hub's gateway's answer to the machine's request, read whole. */
  async relay(machine: string, request: McpRequest): Promise<McpAnswer> {
    const { scope, admitted } = await this.scopeOf(machine, request.path)
    const key = `${machine}\u0000${scope}`
    if (!admitted) {
      if (!this.refused.has(key)) this.deps.log(`link: machine ${machine} asked ${request.path}, a server of a project outside its pool: refused`)
      this.refused.add(key)
      return answerOf(403)
    }
    this.refused.delete(key)
    const origin = this.deps.origin()
    if (origin === undefined) return answerOf(503)
    try {
      const headers = { ...Object.fromEntries(Object.entries(request.headers).filter(([name]) => FORWARD.includes(name.toLowerCase()))), [MACHINE_HEADER]: machine }
      const response = await fetch(`${origin}${request.path}`, { method: request.method, headers, body: request.body, signal: AbortSignal.timeout(RELAY_TIMEOUT_MS) })
      const back: Record<string, string> = {}
      for (const name of BACK) {
        const value = response.headers.get(name)
        if (value !== null) back[name] = value
      }
      return { status: response.status, headers: back, body: await response.text() }
    } catch (error) {
      this.deps.log(`link: the hub's MCP gateway did not answer ${request.path}: ${errorReason(error)}`)
      return answerOf(502)
    }
  }

  /**
   * A write the machine kept while the hub was away. A hub that cannot make it now throws, and the machine sends it
   * again; any answer of the tasks server, a refusal too, is the write's end: the session was told it went later.
   */
  async write(machine: string, write: KeptWrite): Promise<void> {
    const body = JSON.stringify(write.message)
    const answer = await this.relay(machine, { path: write.path, method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body })
    if (answer.status === 502 || answer.status === 503) throw new Error(`the hub's MCP gateway answered ${answer.status}`)
    const name = (write.message.params as { name?: unknown } | undefined)?.name
    const refused = answer.status !== 200 ? `answered ${answer.status}` : refusalIn(answer.body)
    if (refused === undefined) this.deps.log(`link: machine ${machine} delivered a ${String(name)} it kept while the hub was away`)
    else this.deps.log(`link: a ${String(name)} machine ${machine} kept while the hub was away is dropped: ${refused}`)
  }
}

function refusalIn(body: string): string | undefined {
  try {
    const reply = JSON.parse(body) as { result?: { isError?: boolean; content?: { text?: string }[] }; error?: { message?: string } }
    if (reply.error !== undefined) return reply.error.message ?? 'an error'
    return reply.result?.isError === true ? (reply.result.content?.[0]?.text ?? 'a tool error') : undefined
  } catch {
    return 'an answer that is not JSON'
  }
}

/**
 * The working folder of a call on the machine: a chain session's worktree, otherwise the repository of the project
 * the call names (its project key or task key) or of the address's project.
 */
export function machineFolderOf(ctx: Pick<MachineContext, 'sessions' | 'configStore' | 'readers'>, scope: TasksScope, named: string | null): string | null {
  const own = scope.task === null ? undefined : ctx.sessions.find((each) => each.task === scope.task && each.lamp !== 'finished' && each.cwd !== '')
  if (own !== undefined) return own.cwd
  const { projects } = ctx.configStore.current
  if (named !== null) {
    const prefix = (/^([a-z][\w]*)-\d+$/i.exec(named)?.[1] ?? named).toUpperCase()
    const readers = ctx.readers()
    const reader = Object.keys(readers.projects).find((each) => idPrefixOf(readers, each).toUpperCase() === prefix)
    const repo = reader === undefined ? undefined : projects[ownerOf(readers, reader)]
    if (repo !== undefined) return repo
  }
  return scope.project === null ? null : (projects[scope.project] ?? null)
}

/** The tasks server of the machine's gateway, over the machine's end of the link. */
export function machineTasks(ctx: Pick<MachineContext, 'sessions' | 'configStore' | 'readers' | 'briefed'>, end: MachineEnd): MachineTasks {
  return new MachineTasks({
    forward: (request) => end.mcp(request),
    keep: async (write) => void (await end.emit(KEPT_WRITE_EVENT, write)),
    delivered: () => end.flushed(),
    folderOf: (scope, named) => machineFolderOf(ctx, scope, named),
    attachmentLimit: () => ctx.configStore.current.attachmentLimit * 1024 * 1024,
    briefOf: (task) => ctx.briefed.kept(task),
    writerOf: (task) => writerOf(ctx, task),
    version: installed(root).version,
  })
}

/** The task's session on the machine that is making a call: the working one, else the newest one not finished. */
export function writerOf(ctx: Pick<MachineContext, 'sessions'>, task: string): Omit<NoteWriter, 'at'> | undefined {
  const open = ctx.sessions.filter((each) => each.task === task && each.lamp !== 'finished')
  const session = open.find((each) => each.lamp === 'working') ?? open.at(-1)
  return session === undefined ? undefined : { session: session.sessionId, branch: session.branch }
}
