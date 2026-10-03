import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeTool, flatten } from '../../src/sessions/entry.js'
import type { MessageRow } from './parse.js'
import { commandOf, streamsOf, type StreamEvent, type TranscriptEntry } from './stream.js'

export const PROMPT_VERSION = 1
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
Answer with only a JSON object, no prose: {"reason": "<code>", "note": "<one or two sentences in Russian: what exactly happened>"}`

const HEAD_EVENTS = 40
const TAIL_EVENTS = 80
const TEXT_LIMIT = 300
const CLI_TIMEOUT_MS = 180_000

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

export interface CliAnswer {
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

export function parseCliOutput(stdout: string): CliAnswer {
  const value = JSON.parse(stdout) as {
    is_error?: boolean
    result?: unknown
    session_id?: unknown
    modelUsage?: Record<string, Record<string, unknown>>
  }
  if (value.is_error === true || typeof value.result !== 'string') {
    throw new Error(`classifier: claude -p failed: ${flatten(String(value.result ?? stdout), TEXT_LIMIT)}`)
  }
  const count = (raw: unknown) => (typeof raw === 'number' && Number.isFinite(raw) ? raw : 0)
  return {
    result: value.result,
    sessionId: typeof value.session_id === 'string' ? value.session_id : '',
    usage: Object.entries(value.modelUsage ?? {}).map(([model, usage]) => ({
      model,
      input: count(usage.inputTokens),
      output: count(usage.outputTokens),
      cacheRead: count(usage.cacheReadInputTokens),
      cacheWrite: count(usage.cacheCreationInputTokens),
    })),
  }
}

export function costRows(sessionId: string, usage: ModelUsage[], account: string, at: string): MessageRow[] {
  return usage.map((item) => ({
    messageId: `tally-classify:${sessionId}:${item.model}`,
    sessionId,
    agentId: null,
    account,
    project: 'tally',
    projectDir: null,
    task: null,
    branch: null,
    entrypoint: 'tally-classify',
    model: item.model,
    speed: null,
    at,
    input: item.input,
    cacheWrite5m: item.cacheWrite,
    cacheWrite1h: 0,
    cacheRead: item.cacheRead,
    output: item.output,
  }))
}

export async function askClaude(binary: string, env: NodeJS.ProcessEnv, prompt: string): Promise<CliAnswer> {
  const cwd = mkdtempSync(join(tmpdir(), 'tally-classify-'))
  const args = [
    '-p',
    '--model', 'haiku',
    '--output-format', 'json',
    '--no-session-persistence',
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--disable-slash-commands',
    '--system-prompt', SYSTEM_PROMPT,
  ]
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(binary, args, { cwd, env, windowsHide: true })
      const out: Buffer[] = []
      const err: Buffer[] = []
      const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS)
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
      child.on('error', reject)
      child.on('close', (code) => {
        clearTimeout(timer)
        const text = Buffer.concat(out).toString('utf8')
        if (code === 0 || text.trim().startsWith('{')) resolve(text)
        else reject(new Error(`classifier: claude -p exited ${code}: ${flatten(Buffer.concat(err).toString('utf8') || text, TEXT_LIMIT)}`))
      })
      child.stdin.end(prompt, 'utf8')
    })
    return parseCliOutput(stdout)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
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
