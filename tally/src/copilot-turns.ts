import { PROMPTS } from '../../src/chain/prompts.js'
import { copilotSession } from './copilot.js'
import type { Source } from './load.js'
import { rolloutLines } from './rollout.js'
import { turnsKey, type Turn, type TurnSource } from './turns.js'

/**
 * A Copilot turn runs from a `user.message` of the session itself to its last model call, tool event or error; the
 * CLI's `assistant.turn_start`/`turn_end` are its model steps inside it, and `session.shutdown` closes it. A reply is a
 * `session.usage_record` with tokens, a subagent's (`agentId`) left out, as for Claude. Chain sessions run with
 * `--no-ask-user`, so no question wait is subtracted.
 */
const VERSION = 1
const RESUMES = Object.values(PROMPTS).map((texts) => texts.resume)
const LIMIT = /usage.?limit|rate.?limit|quota|premium request|too many requests/i
const LIMIT_ERRORS: ReadonlySet<unknown> = new Set(['rate_limit', 'quota'])
type Json = Record<string, unknown>

export function copilotTurnsKey(launched: boolean): string {
  return `copilot:${VERSION}:${turnsKey(launched)}`
}

export function copilotTurnSources(sources: Source[]): TurnSource[] {
  return sources.flatMap(({ path }) => {
    const session = copilotSession(path)
    return session === null ? [] : [{ session, path, key: copilotTurnsKey, read: (launched: boolean) => readCopilotTurns(path, launched) }]
  })
}

export async function readCopilotTurns(path: string, launched: boolean): Promise<Turn[]> {
  const builder = new CopilotTurnBuilder(launched)
  for await (const line of rolloutLines(path)) builder.push(line)
  return builder.finish()
}

export class CopilotTurnBuilder {
  private readonly turns: Turn[] = []
  private current: Turn | null = null

  constructor(private readonly launched: boolean) {}

  push(text: string): void {
    const event = json(text)
    const data = object(event?.data)
    const at = event?.timestamp
    const type = event?.type
    if (data === undefined || typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || typeof type !== 'string') return
    const own = typeof event?.agentId !== 'string' || event.agentId === ''
    if (type === 'user.message' && own) {
      this.begin(at, event?.id, data.content)
      return
    }
    const turn = this.current
    if (turn === null) return
    if (type === 'session.shutdown' || type === 'session.start' || type === 'session.resume') {
      this.current = null
      return
    }
    if (type === 'session.usage_record') {
      const usage = object(data.usage)
      if (!hasTokens(usage)) return
      if (own) turn.replies++
    } else if (type === 'session.error') {
      const message = typeof data.message === 'string' ? data.message : ''
      if (LIMIT_ERRORS.has(data.errorType) || LIMIT.test(message)) turn.limited = true
    } else if (!type.startsWith('assistant.') && !type.startsWith('tool.') && type !== 'abort') return
    if (at > turn.endedAt) turn.endedAt = at
  }

  finish(): Turn[] {
    return this.turns
  }

  private begin(at: string, id: unknown, content: unknown): void {
    const text = typeof content === 'string' ? content : ''
    const first = this.turns.length === 0
    this.current = {
      startUuid: typeof id === 'string' && id !== '' ? id : `copilot-turn:${this.turns.length}:${at}`,
      start: RESUMES.some((resume) => text.startsWith(resume)) ? 'resume' : first && this.launched ? 'launch' : 'prompt',
      startedAt: at, endedAt: at, replies: 0, askSeconds: 0, limited: false, cliSeconds: null,
    }
    this.turns.push(this.current)
  }
}

function hasTokens(usage: Json | undefined): boolean {
  return typeof usage?.inputTokens === 'number' && usage.inputTokens > 0
    || typeof usage?.outputTokens === 'number' && usage.outputTokens > 0
}

function json(text: string): Json | undefined {
  try { return object(JSON.parse(text)) } catch { return undefined }
}

function object(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : undefined
}
