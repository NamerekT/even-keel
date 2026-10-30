import { PROMPTS } from '../../src/chain/prompts.js'
import { topSessions, turnRows, type TurnRow } from '../../src/opencode/db.js'
import type { Source } from './load.js'
import { turnsKey, type Turn, type TurnSource } from './turns.js'

/**
 * An OpenCode turn runs from a user message of the session itself that has text to the last completion of a response
 * in it, its subagents' responses included; a user message without text (a compaction's) starts none. A reply is a
 * response of the session itself with tokens, one per model call. Chain sessions have no question tool, so no wait is
 * subtracted.
 */
const VERSION = 1
const RESUMES = Object.values(PROMPTS).map((texts) => texts.resume)
const LIMIT = /usage.?limit|rate.?limit|quota|too many requests/i
type Json = Record<string, unknown>

export function openCodeTurnsKey(launched: boolean): string {
  return `opencode:${VERSION}:${turnsKey(launched)}`
}

/** A source per session of each readable database; a database that cannot be read gives none. */
export async function openCodeTurnSources(sources: Source[]): Promise<TurnSource[]> {
  const found: TurnSource[] = []
  for (const { path } of sources) {
    for (const session of (await topSessions(path)) ?? []) {
      found.push({ session, path, key: openCodeTurnsKey, read: (launched) => readOpenCodeTurns(path, session, launched) })
    }
  }
  return found
}

async function readOpenCodeTurns(path: string, session: string, launched: boolean): Promise<Turn[]> {
  const rows = await turnRows(path, session)
  if (rows === undefined) throw new Error('the OpenCode database could not be read')
  return openCodeTurns(rows, launched)
}

export function openCodeTurns(rows: TurnRow[], launched: boolean): Turn[] {
  const turns: Turn[] = []
  let turn: Turn | null = null
  for (const row of rows) {
    const data = json(row.data)
    if (data === undefined) continue
    const at = new Date(row.at).toISOString()
    if (data.role === 'user') {
      if (row.sub === 1 || row.text === null || row.text.trim() === '') continue
      turn = {
        startUuid: row.id,
        start: RESUMES.some((resume) => row.text!.startsWith(resume)) ? 'resume' : turns.length === 0 && launched ? 'launch' : 'prompt',
        startedAt: at, endedAt: at, replies: 0, askSeconds: 0, limited: false, cliSeconds: null,
      }
      turns.push(turn)
      continue
    }
    if (turn === null || data.role !== 'assistant') continue
    const completed = object(data.time)?.completed
    const end = typeof completed === 'number' ? new Date(Math.max(completed, row.at)).toISOString() : at
    if (end > turn.endedAt) turn.endedAt = end
    if (row.sub === 0 && hasTokens(object(data.tokens))) turn.replies++
    const error = object(object(data.error)?.data)
    if (error?.statusCode === 429 || (typeof error?.message === 'string' && LIMIT.test(error.message))) turn.limited = true
  }
  return turns
}

function hasTokens(tokens: Json | undefined): boolean {
  const cache = object(tokens?.cache)
  return [tokens?.input, tokens?.output, tokens?.reasoning, cache?.read, cache?.write].some((count) => typeof count === 'number' && count > 0)
}

function json(text: string): Json | undefined {
  try { return object(JSON.parse(text)) } catch { return undefined }
}

function object(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : undefined
}
