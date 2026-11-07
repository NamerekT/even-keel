import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readAsked, sendAnswer, shellCall, sideAnswer, wireOf, type Answer, type Side, type Wire } from './wire.fixture.js'

/** A call of a tool the CLI offered, by its name there. */
export interface ToolCall {
  name: string
  args: Record<string, unknown>
}

/** One answer of the model: commands of the CLI's shell tool, calls of any tools, or a text that ends the turn. */
export type Reply = { bash: string[] } | { calls: ToolCall[] } | { text: string }

/**
 * A reply made when its request comes, from the tools that request offers and the text of the last tool result.
 * `{ wait }` answers with its reply and keeps the function for the next request.
 */
export type LateReply = (tools: string[], result: string) => Reply | { wait: Reply }

/** What the model was asked: the task it took the request for, the tools the CLI offered, the last tool result. */
export interface ModelRequest {
  wire: Wire
  /** `null` for a request of the CLI's own (`side`) and for one of no script's task. */
  task: string | null
  tools: string[]
  result: string
  side: Side | null
  reply: Reply
}

/**
 * A model behind a local port that speaks the APIs of the three CLIs (BTN-500's provider): OpenAI-compatible
 * `/v1/chat/completions`, Anthropic's `/v1/messages` and OpenAI's `/v1/responses`, each streamed. Each request of a
 * task's session plays the task's next reply of `script`, in order across its turns, so no provider is billed and the
 * model cannot decide anything. A request is taken for the task whose id opens a line of the session's user messages —
 * the launch prompt — else for the one named first in the earliest message that names one; a request the CLI makes for itself (`Side`) takes no reply and gets
 * what a real model would answer.
 */
export class ScriptedModel {
  readonly requests: ModelRequest[] = []
  private readonly scripts = new Map<string, (Reply | LateReply)[]>()
  private server: Server | undefined
  private calls = 0

  /** The task's replies, each taken by one request; a function is called when its request comes. */
  script(task: string, ...replies: (Reply | LateReply)[]): void {
    this.scripts.set(task, [...(this.scripts.get(task) ?? []), ...replies])
  }

  /** The replies of `task` not taken yet. */
  left(task: string): number {
    return this.scripts.get(task)?.length ?? 0
  }

  /** Listens on a free port of 127.0.0.1; the base URL with `/v1` that a provider's `baseURL` takes. */
  async start(): Promise<string> {
    const server = createServer((request, response) => {
      let raw = ''
      request.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')))
      request.on('end', () => this.answer(request.url ?? '', raw, response))
    })
    this.server = server
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server === undefined) return
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }

  private answer(url: string, raw: string, response: ServerResponse): void {
    const path = url.replace(/\?.*$/, '')
    if (path.endsWith('/messages/count_tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ input_tokens: 1000 }))
      return
    }
    const wire = wireOf(path)
    if (wire === null) {
      response.writeHead(404).end()
      return
    }
    const body = JSON.parse(raw) as Record<string, unknown>
    const asked = readAsked(wire, body)
    const task = asked.side === null ? this.taskOf(asked.users) : null
    const reply: Reply = asked.side !== null ? { text: sideAnswer(asked.side, asked) } : this.next(task, asked.tools, asked.result)
    this.requests.push({ wire, task, tools: asked.tools, result: asked.result, side: asked.side, reply })
    sendAnswer(wire, answerOf(reply, asked.tools), ++this.calls, typeof body.model === 'string' ? body.model : 'scripted', response)
  }

  private next(task: string | null, tools: string[], result: string): Reply {
    const replies = task === null ? undefined : this.scripts.get(task)
    const next = replies?.[0]
    if (next === undefined) return { text: 'NO SCRIPT: the scripted model has no reply left.' }
    const made = typeof next === 'function' ? next(tools, result) : next
    if ('wait' in made) return made.wait
    replies!.shift()
    return made
  }

  /**
   * The task a request belongs to. Even Keel's prompt opens a line with the task's id; a CLI's own context
   * (Claude's gitStatus with earlier `[ABC-1] Work` commits) names other tasks only inside a line.
   */
  private taskOf(users: string[]): string | null {
    for (const text of users) {
      for (const task of this.scripts.keys()) if (new RegExp(`(^|\\n)${task}(\\s|$)`).test(text)) return task
    }
    for (const text of users) {
      let found: { task: string; at: number } | null = null
      for (const task of this.scripts.keys()) {
        const at = text.indexOf(task)
        if (at >= 0 && (found === null || at < found.at)) found = { task, at }
      }
      if (found !== null) return found.task
    }
    return null
  }
}

function answerOf(reply: Reply, tools: string[]): Answer {
  if (!('bash' in reply)) return reply
  const calls = reply.bash.map((command) => shellCall(tools, command))
  if (calls.some((call) => call === null)) return { text: `NO SHELL among ${tools.join(', ')}` }
  return { calls: calls as ToolCall[] }
}
