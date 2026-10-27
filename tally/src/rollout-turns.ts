import { PROMPTS } from '../../src/chain/prompts.js'
import { rolloutLines } from './rollout.js'
import { turnsKey, type Turn } from './turns.js'

const VERSION = 1
const RESUMES = Object.values(PROMPTS).map((texts) => texts.resume)
const LIMIT = /usage.?limit|rate.?limit|quota/i
type ObjectRow = Record<string, unknown>
type Span = [number, number]
type PendingTurn = Turn & { waits: Span[]; sawReply: boolean }

export function rolloutTurnsKey(launched: boolean): string {
  return `codex:${VERSION}:${turnsKey(launched)}`
}

export async function readRolloutTurns(path: string, launched: boolean): Promise<Turn[]> {
  const builder = new RolloutTurnBuilder(launched)
  for await (const line of rolloutLines(path)) builder.push(line)
  return builder.finish()
}

/** Rollout boundaries and visible question waits; no Claude-format rows are synthesized. */
export class RolloutTurnBuilder {
  private readonly turns: PendingTurn[] = []
  private current: PendingTurn | null = null
  private readonly records = new Map<string, PendingTurn>()
  private readonly counts = new Map<number, PendingTurn>()
  private readonly recordTotals = new Set<number>()
  private readonly asked = new Map<string, { turn: PendingTurn; since: number }>()

  constructor(private readonly launched: boolean) {}

  push(text: string): void {
    const line = json(text)
    const payload = object(line?.payload)
    const at = line?.timestamp
    if (payload === undefined || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return
    const kind = payload.type
    if (line?.type === 'event_msg' && kind === 'task_started') {
      this.begin(at, payload.turn_id)
      return
    }
    if (line?.type === 'turn_context' && this.current === null) this.begin(at, payload.turn_id)
    if (line?.type === 'event_msg' && kind === 'user_message' && this.current === null) this.begin(at)
    const turn = this.current
    if (turn === null) return
    if (line?.type === 'event_msg' && typeof payload.turn_id === 'string'
      && !turn.startUuid.startsWith('codex-turn:') && payload.turn_id !== turn.startUuid) return

    if (line?.type === 'event_msg') {
      const item = object(payload.item)
      if (kind === 'user_message') this.prompt(payload.message)
      if (kind === 'agent_message') {
        turn.sawReply = true
        this.touch(at)
      }
      if (kind === 'agent_reasoning') this.touch(at)
      if (kind === 'item_completed' && item?.type === 'UserMessage') this.prompt(contentText(item.content))
      if (kind === 'item_completed' && item?.type === 'AgentMessage') turn.sawReply = true
      if (kind === 'token_count') {
        const info = object(payload.info)
        const total = object(info?.total_token_usage)?.total_tokens
        if (typeof total === 'number' && hasUsage(object(info?.last_token_usage)) && !this.counts.has(total)) {
          this.counts.set(total, turn)
          this.touch(at)
        }
      } else if (kind === 'error' || kind === 'task_complete') {
        if (LIMIT.test(JSON.stringify(kind === 'error' ? payload : payload.error ?? {}))) turn.limited = true
        this.touch(at)
      } else if (kind === 'item_completed' && item?.type !== 'UserMessage') this.touch(at)
      if (kind === 'task_complete' || kind === 'turn_aborted') {
        this.touch(at)
        this.current = null
      }
    } else if (line?.type === 'token_usage_record') {
      if (typeof payload.response_id !== 'string' || !hasUsage(object(payload.usage))) return
      this.records.set(payload.response_id, turn)
      const total = object(payload.thread_token_usage)?.total_tokens
      if (typeof total === 'number') this.recordTotals.add(total)
      this.touch(at)
    } else if (line?.type === 'response_item') {
      if (kind === 'message' && payload.role === 'user') this.prompt(contentText(payload.content))
      if (kind === 'message' && payload.role === 'assistant') turn.sawReply = true
      if (kind === 'function_call' && typeof payload.name === 'string' && /(?:^|\.)request_user_input$/.test(payload.name)
        && typeof payload.call_id === 'string' && !this.asked.has(payload.call_id)) {
        this.asked.set(payload.call_id, { turn, since: Date.parse(at) })
      }
      if (kind === 'function_call_output' && typeof payload.call_id === 'string') {
        const asked = this.asked.get(payload.call_id)
        if (asked !== undefined && asked.turn === turn) {
          asked.turn.waits.push([asked.since, Date.parse(at)])
          this.asked.delete(payload.call_id)
        }
      }
      if ((kind === 'message' && payload.role === 'assistant') || kind === 'reasoning'
        || (typeof kind === 'string' && /^(function|custom_tool)_call(_output)?$/.test(kind))) this.touch(at)
    }
  }

  finish(): Turn[] {
    const replies = new Map<PendingTurn, number>()
    for (const turn of this.records.values()) replies.set(turn, (replies.get(turn) ?? 0) + 1)
    for (const [total, turn] of this.counts) {
      if (!this.recordTotals.has(total)) replies.set(turn, (replies.get(turn) ?? 0) + 1)
    }
    return this.turns.map(({ waits, sawReply, ...turn }, index) => {
      const source = this.turns[index]!
      const until = Date.parse(turn.endedAt)
      const pending = [...this.asked.values()].filter((asked) => asked.turn === source).map((asked): Span => [asked.since, until])
      return { ...turn, replies: replies.get(source) ?? (sawReply ? 1 : 0), askSeconds: unionSeconds([...waits, ...pending], until) }
    })
  }

  private begin(at: string, id?: unknown): void {
    if (typeof id === 'string' && this.turns.some((turn) => turn.startUuid === id)) return
    this.current = {
      startUuid: typeof id === 'string' ? id : `codex-turn:${this.turns.length}:${at}`,
      start: this.turns.length === 0 && this.launched ? 'launch' : 'prompt',
      startedAt: at, endedAt: at, replies: 0, askSeconds: 0, limited: false, cliSeconds: null,
      waits: [], sawReply: false,
    }
    this.turns.push(this.current)
  }

  private prompt(text: unknown): void {
    if (this.current !== null && typeof text === 'string' && RESUMES.some((resume) => text.startsWith(resume))) this.current.start = 'resume'
  }

  private touch(at: string): void {
    if (this.current !== null && at > this.current.endedAt) this.current.endedAt = at
  }
}

function unionSeconds(spans: Span[], until: number): number {
  let end = -Infinity
  let milliseconds = 0
  for (const [start, stop] of spans.sort((a, b) => a[0] - b[0])) {
    const to = Math.min(stop, until)
    milliseconds += Math.max(0, to - Math.max(start, end))
    end = Math.max(end, to)
  }
  return milliseconds / 1000
}

function hasUsage(usage: ObjectRow | undefined): boolean {
  return typeof usage?.input_tokens === 'number' && usage.input_tokens > 0
    || typeof usage?.output_tokens === 'number' && usage.output_tokens > 0
}

function contentText(content: unknown): string {
  return Array.isArray(content) ? content.map((block) => object(block)?.text ?? '').join('\n') : typeof content === 'string' ? content : ''
}

function json(text: string): ObjectRow | undefined {
  try { return object(JSON.parse(text)) } catch { return undefined }
}

function object(value: unknown): ObjectRow | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as ObjectRow : undefined
}
