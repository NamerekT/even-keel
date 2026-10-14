import { resolve } from 'node:path'
import { describeTool, flatten } from '../../src/sessions/entry.js'
import type { MessageRow } from './parse.js'
import { commandOf, streamsOf, type StreamEvent, type TranscriptEntry } from './stream.js'
import { placeOf } from './task.js'

export const PROMPT_VERSION = 2
export const DEFAULT_LLM_MODEL = 'google-gemini-3.1-flash-lite'
export const REASONS = ['unclear_task', 'broken_tooling', 'debug_loop', 'waiting_user', 'limit_env', 'normal', 'other'] as const
export type Reason = (typeof REASONS)[number]

export const SYSTEM_PROMPT = `You review an excerpt of a Claude Code agent session. Cheap heuristics flagged this stretch as possibly stuck or repeating work.
Pick the single most likely reason:
- unclear_task: the task or the user's request was ambiguous or underspecified; the agent guessed, asked, or redid work after a clarification.
- broken_tooling: tools, hooks, permissions, MCP servers or the environment failed regardless of what the agent did.
- debug_loop: the agent went in circles: re-running the same commands or tests, trying fixes without new information.
- waiting_user: the agent was blocked waiting for the user's answer or approval.
- limit_env: usage limits, context compaction, a hand-off between sessions, timeouts.
- normal: a false alarm; steady progress, the flagged pattern is expected for this work.
- other: none of the above.
A first prompt that is only a task ID (like "BTN-12") is normal: the agent reads the task text from the tracker.
Answer with only a JSON object, no prose: {"reason": "<code>", "note": "<one or two sentences in Russian: what exactly happened>"}`

const HEAD_EVENTS = 40
const TAIL_EVENTS = 80
const TEXT_LIMIT = 300
const REQUEST_TIMEOUT_MS = 180_000

export interface LlmSettings {
  url: string
  key: string
  model: string
}

export interface SpanBounds {
  agentId: string | null
  fromAt: string
  toAt: string
}

export interface Verdict {
  reason: Reason
  note: string
}

export interface ModelUsage {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface ModelAnswer {
  result: string
  sessionId: string
  usage: ModelUsage[]
}

export function excerptOf(entries: TranscriptEntry[], span: SpanBounds): string {
  const stream = streamsOf(entries).find((item) => item.agentId === span.agentId)
  if (stream === undefined) return ''
  const before = stream.events.filter((event) => event.at < span.fromAt && event.type === 'prompt').at(-1)
  const inside = stream.events.filter((event) => event.at >= span.fromAt && event.at <= span.toAt)
  const lines = [...(before === undefined ? [] : [before]), ...inside].flatMap((event) => lineOf(event) ?? [])
  if (lines.length <= HEAD_EVENTS + TAIL_EVENTS) return lines.join('\n')
  const skipped = lines.length - HEAD_EVENTS - TAIL_EVENTS
  return [...lines.slice(0, HEAD_EVENTS), `… ${skipped} events skipped …`, ...lines.slice(-TAIL_EVENTS)].join('\n')
}

export function promptOf(task: string | null, signs: string[], excerpt: string): string {
  return [`Task: ${task ?? 'unknown'}`, 'Flags:', ...signs.map((sign) => `- ${sign}`), '', 'Excerpt (UTC time, one event per line):', excerpt].join('\n')
}

export function parseVerdict(text: string): Verdict {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (json === undefined) throw new Error(`classifier: no JSON in the answer: ${flatten(text, TEXT_LIMIT)}`)
  const value = JSON.parse(json) as { reason?: unknown; note?: unknown }
  if (!REASONS.includes(value.reason as Reason)) throw new Error(`classifier: unknown reason ${String(value.reason)}`)
  return { reason: value.reason as Reason, note: typeof value.note === 'string' ? value.note.trim() : '' }
}

export function llmSettings(env: NodeJS.ProcessEnv): LlmSettings | undefined {
  if (!env.TALLY_LLM_URL || !env.TALLY_LLM_KEY) return undefined
  return { url: env.TALLY_LLM_URL.replace(/\/+$/, ''), key: env.TALLY_LLM_KEY, model: env.TALLY_LLM_MODEL || DEFAULT_LLM_MODEL }
}

export function parseChatResponse(body: unknown): ModelAnswer {
  const value = (body ?? {}) as {
    id?: unknown
    model?: unknown
    error?: { message?: unknown }
    choices?: { message?: { content?: unknown } }[]
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } }
  }
  if (value.error !== undefined) {
    throw new Error(`classifier: LiteLLM failed: ${flatten(String(value.error.message ?? JSON.stringify(value.error)), TEXT_LIMIT)}`)
  }
  const result = value.choices?.[0]?.message?.content
  if (typeof result !== 'string' || result.trim() === '') throw new Error('classifier: LiteLLM returned no answer')
  const count = (raw: unknown) => (typeof raw === 'number' && Number.isFinite(raw) ? raw : 0)
  const cached = count(value.usage?.prompt_tokens_details?.cached_tokens)
  return {
    result,
    sessionId: typeof value.id === 'string' ? value.id : '',
    usage: [
      {
        model: typeof value.model === 'string' ? value.model.replace(/^[^/]+\//, '') : 'unknown',
        input: count(value.usage?.prompt_tokens) - cached,
        output: count(value.usage?.completion_tokens),
        cacheRead: cached,
        cacheWrite: 0,
      },
    ],
  }
}

const home = placeOf(resolve(import.meta.dirname, '..', '..'))

export function costRows(sessionId: string, usage: ModelUsage[], account: string, at: string): MessageRow[] {
  return usage.map((item) => ({
    messageId: `tally-classify:${sessionId}:${item.model}`,
    sessionId,
    agentId: null,
    account,
    project: home.project,
    projectDir: home.dir,
    task: null,
    branch: null,
    entrypoint: 'tally-classify',
    model: item.model,
    speed: null,
    effort: null,
    at,
    input: item.input,
    cacheWrite5m: item.cacheWrite,
    cacheWrite1h: 0,
    cacheRead: item.cacheRead,
    output: item.output,
  }))
}

export async function askModel(llm: LlmSettings, prompt: string): Promise<ModelAnswer> {
  const response = await fetch(`${llm.url}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${llm.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`classifier: LiteLLM answered ${response.status}: ${flatten(text, TEXT_LIMIT)}`)
  }
  return parseChatResponse(response.ok ? body : { error: (body as { error?: unknown }).error ?? { message: `${response.status} ${text}` } })
}

function lineOf(event: StreamEvent): string | undefined {
  const time = event.at.slice(11, 19)
  switch (event.type) {
    case 'prompt':
      return `${time} user: ${flatten(event.text, TEXT_LIMIT)}`
    case 'say':
      return `${time} assistant: ${flatten(event.text, TEXT_LIMIT)}`
    case 'compact':
      return `${time} [context compacted]`
    case 'reply':
      return undefined
    case 'call': {
      const { call } = event
      const command = commandOf(call)
      const what = command === null ? describeTool(call.name, call.input, call.cwd) : `${call.name}: ${flatten(command, TEXT_LIMIT)}`
      const result = call.result
      const outcome =
        result === undefined ? 'no result' : result.isError ? `${result.kind ?? 'error'}: ${flatten(result.text, TEXT_LIMIT)}` : 'ok'
      return `${time} ${what} → ${outcome}`
    }
  }
}
