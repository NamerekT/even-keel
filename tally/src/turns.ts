import { createHash } from 'node:crypto'
import { PROMPTS } from '../../src/chain/prompts.js'
import { blocksOf } from '../../src/sessions/entry.js'
import type { TranscriptEntry } from './stream.js'

const RESUME_PROMPTS = Object.values(PROMPTS).map((texts) => texts.resume)

export type TurnStart = 'launch' | 'prompt' | 'resume' | 'notification' | 'message'

export interface Turn {
  startUuid: string
  start: TurnStart
  startedAt: string
  endedAt: string
  replies: number
  askSeconds: number
  limited: boolean
  cliSeconds: number | null
}

type Origin = { kind?: string; body?: unknown }
type TurnEntry = TranscriptEntry & { origin?: Origin; isCompactSummary?: boolean; durationMs?: unknown }

const TURNS_VERSION = 4
const USER_WAIT_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'ExitPlanMode'])
const NOT_STARTER = /^\s*(<(local-command-|system-reminder)|\[Request interrupted)/
const NOTIFICATION = /^\s*<task-notification>/
const SESSION_MESSAGE = /^\s*Another Claude session sent a message/

export function turnsKey(launched: boolean): string {
  return createHash('sha1').update(JSON.stringify([TURNS_VERSION, launched])).digest('hex')
}

export function turnsOf(entries: TranscriptEntry[], launched: boolean): Turn[] {
  const turns: Turn[] = []
  const asked = new Map<string, number>()
  const replies = new Set<string>()
  let turn: Turn | null = null
  for (const entry of entries as TurnEntry[]) {
    const at = entry.timestamp
    if (typeof entry.uuid !== 'string' || typeof at !== 'string') continue
    if (typeof entry.agentId === 'string' && entry.agentId !== '') {
      if (turn !== null && isReply(entry) && at > turn.endedAt) turn.endedAt = at
      continue
    }
    const start = startOf(entry)
    if (start !== null) {
      const first = turns.length === 0
      turn = {
        startUuid: entry.uuid,
        start: first && launched && start === 'prompt' ? 'launch' : start,
        startedAt: at,
        endedAt: at,
        replies: 0,
        askSeconds: 0,
        limited: false,
        cliSeconds: null,
      }
      turns.push(turn)
      continue
    }
    if (turn === null) continue
    if (entry.type === 'system' && entry.subtype === 'turn_duration' && typeof entry.durationMs === 'number') {
      turn.cliSeconds = entry.durationMs / 1000
    } else if (entry.type === 'assistant') {
      if (entry.isApiErrorMessage === true) {
        if (entry.error === 'rate_limit') turn.limited = true
        continue
      }
      if (entry.message?.model === '<synthetic>') continue
      if (typeof entry.usageLimitNote === 'string') turn.limited = true
      const id = entry.message?.id
      if (typeof id === 'string' && !replies.has(id)) {
        replies.add(id)
        turn.replies++
      }
      if (at > turn.endedAt) turn.endedAt = at
      for (const block of blocksOf(entry.message?.content)) {
        if (block.type === 'tool_use' && typeof block.id === 'string' && USER_WAIT_TOOLS.has(String(block.name))) {
          asked.set(block.id, Date.parse(at))
        }
      }
    } else if (entry.type === 'user') {
      for (const block of blocksOf(entry.message?.content)) {
        if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
        const since = asked.get(block.tool_use_id)
        if (since === undefined) continue
        asked.delete(block.tool_use_id)
        turn.askSeconds += Math.max(0, (Date.parse(at) - since) / 1000)
      }
    }
  }
  return turns
}

function isReply(entry: TurnEntry): boolean {
  return entry.type === 'assistant' && entry.isApiErrorMessage !== true && entry.message?.model !== '<synthetic>'
}

function startOf(entry: TurnEntry): TurnStart | null {
  if (entry.type === 'system' && entry.subtype === 'scheduled_task_fire') return 'notification'
  if (entry.type !== 'user' || entry.isCompactSummary === true) return null
  const blocks = blocksOf(entry.message?.content)
  if (blocks.some((block) => block.type === 'tool_result')) return null
  const text = textOf(entry.message?.content)
  if (entry.isMeta === true) {
    return entry.origin?.body !== undefined || SESSION_MESSAGE.test(text) ? 'message' : null
  }
  if (RESUME_PROMPTS.some((prompt) => text.startsWith(prompt))) return 'resume'
  if (entry.origin?.kind === 'human') return 'prompt'
  if (entry.origin?.kind === 'task-notification' || NOTIFICATION.test(text)) return 'notification'
  return text.trim() === '' || NOT_STARTER.test(text) ? null : 'prompt'
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  return blocksOf(content)
    .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
}
