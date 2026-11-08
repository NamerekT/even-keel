import type { ServerResponse } from 'node:http'

/** The API a CLI talks: OpenCode's OpenAI-compatible chat, Claude Code's Messages, Codex's Responses. */
export type Wire = 'chat' | 'messages' | 'responses'

/**
 * A request the CLI makes for itself, not for the session's turn: a title, Claude Code's state of a `--bg` session
 * (`claude agents` shows it, and `done` reads as over) or Codex's guardian review of a command in `approve-for-me`.
 */
export type Side = 'title' | 'state' | 'guardian'

/** A request as each wire carries it: the user's texts in order, the offered tools, the last tool result. */
export interface Asked {
  users: string[]
  tools: string[]
  /** The text of the last tool result the request carries; '' without one. */
  result: string
  side: Side | null
  /** All the text the CLI sent: the system prompt and every message, in order — where a project's rules file lands. */
  context: string
}

/** What the model answers: calls of offered tools, or a text that ends the turn. */
export type Answer = { calls: { name: string; args: Record<string, unknown> }[] } | { text: string }

type Json = Record<string, any>

/** The wire of a request's path, `null` for a path no CLI posts a turn to. */
export function wireOf(path: string): Wire | null {
  if (path.endsWith('/chat/completions')) return 'chat'
  if (path.endsWith('/messages')) return 'messages'
  if (path.endsWith('/responses')) return 'responses'
  return null
}

export function readAsked(wire: Wire, body: Json): Asked {
  if (wire === 'chat') {
    const messages: Json[] = body.messages ?? []
    const tools = (body.tools ?? []).map((tool: Json) => tool.function?.name ?? '')
    const last = messages.at(-1)
    const context = messages.map((message) => textOf(message?.content)).join('\n')
    return { users: textsOf(messages, 'user'), tools, result: last?.role === 'tool' ? textOf(last.content) : '', side: tools.length === 0 ? 'title' : null, context }
  }
  if (wire === 'messages') {
    const messages: Json[] = body.messages ?? []
    const tools = (body.tools ?? []).map((tool: Json) => tool.name ?? '')
    const last = messages.at(-1)
    const results = Array.isArray(last?.content) ? last.content.filter((part: Json) => part?.type === 'tool_result') : []
    const system = Array.isArray(body.system) ? body.system.map((part: Json) => part?.text ?? '').join('\n') : String(body.system ?? '')
    const side = tools.length > 0 ? null : system.includes('"state":"<working|blocked|done|failed>"') ? 'state' : 'title'
    const context = [system, ...messages.map((message) => textOf(message?.content))].join('\n')
    return { users: textsOf(messages, 'user'), tools, result: results.map((part: Json) => textOf(part.content)).join('\n'), side, context }
  }
  const input: Json[] = Array.isArray(body.input) ? body.input : []
  const tools = responsesTools(body.tools ?? [])
  const last = input.at(-1)
  const result = last?.type === 'function_call_output' ? textOf(last.output) : ''
  const side = body.text?.format?.type === 'json_schema' ? 'guardian' : tools.length === 0 ? 'title' : null
  const context = [typeof body.instructions === 'string' ? body.instructions : '', ...input.map((item) => textOf(item.content ?? item.output))].join('\n')
  return { users: textsOf(input.filter((item) => item.type === 'message'), 'user'), tools, result, side, context }
}

/** What a real model would say to a request of the CLI's own; a short text for a title. */
export function sideAnswer(side: Side, asked: Asked): string {
  if (side === 'guardian') return JSON.stringify({ outcome: 'allow', risk_level: 'low', user_authorization: 'high', rationale: 'The scripted bench.' })
  if (side === 'title') return 'Task'
  // The state request quotes the tail of the turn's last text: a question there waits for the user.
  const tail = /Assistant message tail[^\n]*\n([\s\S]*)$/.exec(asked.users.at(-1) ?? '')?.[1]?.trim() ?? ''
  const blocked = tail.endsWith('?')
  return JSON.stringify({ state: blocked ? 'blocked' : 'done', detail: 'Scripted turn', tempo: blocked ? 'blocked' : 'idle', ...(blocked ? { needs: tail } : {}), output: {} })
}

/** The shell tool among the offered ones and its arguments for a command; `null` — none is offered. */
export function shellCall(tools: string[], command: string): { name: string; args: Record<string, unknown> } | null {
  const name = tools.find((tool) => tool in SHELLS)
  return name === undefined ? null : { name, args: SHELLS[name]!(command) }
}

const SHELLS: Record<string, (command: string) => Record<string, unknown>> = {
  bash: (command) => ({ command, description: 'Scripted step' }),
  Bash: (command) => ({ command, description: 'Scripted step' }),
  exec_command: (cmd) => ({ cmd }),
  shell_command: (command) => ({ command }),
}

/** The input tokens an answer reports unless its reply says otherwise. */
export const SMALL_USAGE = 1000

/** Streams the answer the way the wire's real API does, reporting `tokens` of input: the context the CLI and Even Keel read. */
export function sendAnswer(wire: Wire, answer: Answer, n: number, model: string, response: ServerResponse, tokens = SMALL_USAGE): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  if (wire === 'chat') sendChat(answer, n, tokens, response)
  else if (wire === 'messages') sendMessages(answer, n, model, tokens, response)
  else sendResponses(answer, n, tokens, response)
  response.end()
}

function sendChat(answer: Answer, n: number, tokens: number, response: ServerResponse): void {
  const base = { id: `chatcmpl-${n}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'scripted' }
  const delta = 'text' in answer
    ? { role: 'assistant', content: answer.text }
    : { role: 'assistant', tool_calls: answer.calls.map(({ name, args }, index) => ({ index, id: `call_${n}_${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }
  const data = (chunk: unknown) => response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  data({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })
  data({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'text' in answer ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: tokens, completion_tokens: 20, total_tokens: tokens + 20 } })
  response.write('data: [DONE]\n\n')
}

function sendMessages(answer: Answer, n: number, model: string, tokens: number, response: ServerResponse): void {
  const event = (type: string, data: Json) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  const stop = 'text' in answer ? 'end_turn' : 'tool_use'
  event('message_start', { message: { id: `msg_${n}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: tokens, output_tokens: 1 } } })
  const blocks = 'text' in answer ? [{ text: answer.text }] : answer.calls
  blocks.forEach((block, index) => {
    if ('text' in block) {
      event('content_block_start', { index, content_block: { type: 'text', text: '' } })
      event('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } })
    } else {
      event('content_block_start', { index, content_block: { type: 'tool_use', id: `toolu_${n}_${index}`, name: block.name, input: {} } })
      event('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.args) } })
    }
    event('content_block_stop', { index })
  })
  event('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } })
  event('message_stop', {})
}

function sendResponses(answer: Answer, n: number, tokens: number, response: ServerResponse): void {
  const event = (data: Json) => response.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)
  const items = 'text' in answer
    ? [{ type: 'message', id: `msg_${n}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: answer.text, annotations: [] }] }]
    : answer.calls.map(({ name, args }, index) => ({ type: 'function_call', id: `fc_${n}_${index}`, call_id: `call_${n}_${index}`, ...namespaced(name), arguments: JSON.stringify(args), status: 'completed' }))
  const id = `resp_${n}`
  event({ type: 'response.created', response: { id, object: 'response', status: 'in_progress', output: [] } })
  items.forEach((item, index) => {
    event({ type: 'response.output_item.added', output_index: index, item: { ...item, status: 'in_progress' } })
    event({ type: 'response.output_item.done', output_index: index, item })
  })
  const usage = { input_tokens: tokens, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: tokens + 20 }
  event({ type: 'response.completed', response: { id, object: 'response', status: 'completed', output: items, usage } })
}

/**
 * Codex offers a server's MCP tools as one `namespace` tool (`mcp__notes` with `note` inside): `readAsked` names each
 * `mcp__notes__note`, as Claude does, and a call of it goes back split.
 */
function namespaced(name: string): { name: string; namespace?: string } {
  const at = name.lastIndexOf(NAMESPACE_JOIN)
  return name.startsWith('mcp__') && at > 'mcp__'.length ? { name: name.slice(at + NAMESPACE_JOIN.length), namespace: name.slice(0, at) } : { name }
}

function responsesTools(tools: Json[]): string[] {
  return tools.flatMap((tool: Json) =>
    tool?.type === 'namespace' && Array.isArray(tool.tools) ? tool.tools.map((inner: Json) => `${tool.name}${NAMESPACE_JOIN}${inner?.name ?? ''}`) : [tool?.name ?? tool?.type ?? ''],
  )
}

const NAMESPACE_JOIN = '__'

function textsOf(messages: Json[], role: string): string[] {
  return messages.filter((message) => message?.role === role).map((message) => textOf(message.content))
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  // A part may hold parts of its own: Anthropic's `tool_result` with a `content` array.
  return content.map((part: Json) => (typeof part?.text === 'string' ? part.text : textOf(part?.content))).join('\n')
}
