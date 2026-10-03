import { blocksOf, type Entry } from '../../src/sessions/entry.js'
import { errorKindOf, resultText, type ErrorKind } from './parse.js'

export type TranscriptEntry = Entry & { parentUuid?: string | null; isCompactSummary?: boolean }

export interface CallResult {
  isError: boolean
  kind: ErrorKind | null
  text: string
}

export interface Call {
  uuid: string
  at: string
  id: string
  name: string
  input: Record<string, unknown>
  cwd: string | undefined
  result?: CallResult
}

export type StreamEvent =
  | { type: 'call'; uuid: string; at: string; call: Call }
  | { type: 'reply'; uuid: string; at: string }
  | { type: 'say'; uuid: string; at: string; text: string }
  | { type: 'prompt'; uuid: string; at: string; parent: string | null; text: string }
  | { type: 'compact'; uuid: string; at: string }

export interface Stream {
  agentId: string | null
  events: StreamEvent[]
}

const NOT_PROMPT = /^\s*<(command-name|command-message|local-command-|task-notification|system-reminder)/

export function streamsOf(entries: TranscriptEntry[]): Stream[] {
  const streams = new Map<string, Stream & { replies: Set<string> }>()
  const calls = new Map<string, Call>()
  for (const entry of entries) {
    const uuid = entry.uuid
    const at = entry.timestamp
    if (typeof uuid !== 'string' || typeof at !== 'string') continue
    const agentId = typeof entry.agentId === 'string' && entry.agentId !== '' ? entry.agentId : null
    let stream = streams.get(agentId ?? '')
    if (stream === undefined) {
      stream = { agentId, events: [], replies: new Set() }
      streams.set(agentId ?? '', stream)
    }
    const events = stream.events

    if (entry.type === 'assistant') {
      const message = entry.message
      if (entry.isApiErrorMessage === true || message?.model === '<synthetic>') continue
      if (typeof message?.id === 'string' && !stream.replies.has(message.id)) {
        stream.replies.add(message.id)
        events.push({ type: 'reply', uuid, at })
      }
      for (const block of blocksOf(message?.content)) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          events.push({ type: 'say', uuid, at, text: block.text })
        } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
          const call: Call = { uuid, at, id: block.id, name: block.name, input: block.input ?? {}, cwd: entry.cwd }
          calls.set(block.id, call)
          events.push({ type: 'call', uuid, at, call })
        }
      }
    } else if (entry.type === 'user') {
      const blocks = blocksOf(entry.message?.content)
      const results = blocks.filter((block) => block.type === 'tool_result')
      for (const block of results) {
        const call = typeof block.tool_use_id === 'string' ? calls.get(block.tool_use_id) : undefined
        if (call === undefined) continue
        const isError = block.is_error === true
        const text = resultText(block)
        call.result = { isError, kind: isError ? errorKindOf(text) : null, text }
      }
      if (results.length > 0 || entry.isMeta === true || entry.isCompactSummary === true) continue
      const text = promptText(entry.message?.content)
      if (text === '' || NOT_PROMPT.test(text)) continue
      events.push({ type: 'prompt', uuid, at, parent: entry.parentUuid ?? null, text })
    } else if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      events.push({ type: 'compact', uuid, at })
    }
  }
  return [...streams.values()].map(({ agentId, events }) => ({ agentId, events }))
}

export function commandOf(call: Call): string | null {
  const command = call.input.command
  return typeof command === 'string' && command.trim() !== '' ? command : null
}

function promptText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  return blocksOf(content)
    .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
    .trim()
}
