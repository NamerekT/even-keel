import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** A call of a tool the CLI offered, by its name there. */
export interface ToolCall {
  name: string
  args: Record<string, unknown>
}

/** One answer of the model: commands of `bash`, calls of any tools, or a text that ends the turn. */
export type Reply = { bash: string[] } | { calls: ToolCall[] } | { text: string }

/** A reply made when its request comes, from the tools that request offers. */
export type LateReply = (tools: string[]) => Reply

/** What the model was asked: the task it took the request for and the tools the CLI offered. */
export interface ModelRequest {
  task: string | null
  tools: string[]
  reply: Reply
}

interface Message {
  role?: string
  content?: unknown
}

/**
 * A model behind an OpenAI-compatible `/v1/chat/completions` on a free local port (BTN-500's provider): each request of
 * a task's session plays the task's next reply of `script`, in order across its turns, so no provider is billed and
 * the model cannot decide anything. A request is taken for the task whose id comes first in the session's first user
 * message, the launch prompt; a request without tools (a title) gets a short text.
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

  /** Listens on a free port of 127.0.0.1; the base URL a provider's `baseURL` takes. */
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

  private answer(url: string, raw: string, response: import('node:http').ServerResponse): void {
    if (!url.endsWith('/chat/completions')) {
      response.writeHead(404).end()
      return
    }
    const body = JSON.parse(raw) as { messages?: Message[]; tools?: { function?: { name?: string } }[] }
    const tools = (body.tools ?? []).map((tool) => tool.function?.name ?? '')
    const task = this.taskOf(body.messages ?? [])
    const next = tools.length === 0 || task === null ? undefined : this.scripts.get(task)?.shift()
    const reply: Reply = next === undefined ? { text: tools.length === 0 ? 'Task' : 'NO SCRIPT: the scripted model has no reply left.' } : typeof next === 'function' ? next(tools) : next
    this.requests.push({ task, tools, reply })
    const base = { id: `chatcmpl-${++this.calls}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'scripted' }
    const calls = 'bash' in reply ? reply.bash.map((command) => ({ name: 'bash', args: { command, description: 'Scripted step' } })) : 'calls' in reply ? reply.calls : null
    const delta = calls === null
      ? { role: 'assistant', content: (reply as { text: string }).text }
      : { role: 'assistant', tool_calls: calls.map(({ name, args }, index) => ({ index, id: `call_${this.calls}_${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }
    const finish = calls === null ? 'stop' : 'tool_calls'
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020 } })}\n\n`)
    response.end('data: [DONE]\n\n')
  }

  private taskOf(messages: Message[]): string | null {
    const first = messages.find((message) => message.role === 'user')
    const text = first === undefined ? '' : textOf(first.content)
    let found: { task: string; at: number } | null = null
    for (const task of this.scripts.keys()) {
      const at = text.indexOf(task)
      if (at >= 0 && (found === null || at < found.at)) found = { task, at }
    }
    return found?.task ?? null
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part: { text?: unknown }) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
}
