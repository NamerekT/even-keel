import { createHash } from 'node:crypto'
import type { LaunchEntry } from '../../src/chain/dispatcher.js'
import { isLaunch } from '../../src/chain/launches.js'
import { blocksOf, describeTool, parseEntry, type ContentBlock, type Entry, type Usage } from '../../src/sessions/entry.js'
import { cleanText, compact } from './compact.js'
import { emptyRuleRows, RuleCollector, type RuleContext, type RuleRows } from './rule-parse.js'
import { placeOf, taskOf } from './task.js'

const ERROR_TEXT_LIMIT = 500
const DENIED = [/^The user doesn't want to proceed with this tool use/, /^Permission for this action was denied/, /permission .*denied/i]
const HOOK = /^(PreToolUse|PostToolUse):\S+ hook error/

export type ErrorKind = 'denied' | 'hook' | 'error'

export interface LineRow {
  uuid: string
  sessionId: string | null
  agentId: string | null
  type: string | null
  at: string | null
  raw: unknown
}

export interface MessageRow {
  messageId: string
  sessionId: string | null
  agentId: string | null
  account: string
  project: string | null
  projectDir: string | null
  task: string | null
  branch: string | null
  entrypoint: string | null
  model: string | null
  speed: string | null
  effort: string | null
  at: string | null
  input: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  output: number
}

export interface CallRow {
  toolUseId: string
  sessionId: string | null
  messageId: string | null
  task: string | null
  name: string
  inputHash: string
  brief: string
  at: string | null
}

export interface ResultRow {
  toolUseId: string
  resultAt: string | null
  isError: boolean
  errorKind: ErrorKind | null
  errorText: string | null
}

export interface SessionRow {
  sessionId: string
  account: string
  project: string | null
  customTitle: string | null
  aiTitle: string | null
  launchTask: string | null
  launchReason: string | null
  firstAt: string | null
  lastAt: string | null
}

export interface Batch extends RuleRows {
  lines: Map<string, LineRow>
  messages: Map<string, MessageRow>
  calls: Map<string, CallRow>
  results: Map<string, ResultRow>
  sessions: Map<string, SessionRow>
}

export interface Launch {
  task: string
  reason: string
}

export interface ParseContext {
  account: string
  launches: ReadonlyMap<string, Launch>
  rules?: RuleContext
  rulesOnly?: boolean
}

export function launchMap(entries: LaunchEntry[]): Map<string, Launch> {
  const map = new Map<string, Launch>()
  for (const entry of entries) {
    if (!isLaunch(entry) || map.has(entry.sessionId)) continue
    map.set(entry.sessionId, { task: entry.task, reason: entry.reason ?? 'launch' })
  }
  return map
}

export function emptyBatch(): Batch {
  return { lines: new Map(), messages: new Map(), calls: new Map(), results: new Map(), sessions: new Map(), ...emptyRuleRows() }
}

export function batchSize(batch: Batch): number {
  return (
    batch.lines.size + batch.messages.size + batch.calls.size + batch.results.size + batch.sessions.size +
    batch.ruleTexts.size + batch.ruleSeen.size + batch.ruleEdits.size + batch.ruleVersions.size
  )
}

export class BatchBuilder {
  batch = emptyBatch()
  private readonly rules: RuleCollector | null

  constructor(private readonly context: ParseContext) {
    this.rules = context.rules === undefined ? null : new RuleCollector(context.rules)
  }

  push(text: string): void {
    const entry = parseEntry(text)
    if (entry === undefined) return
    this.rules?.push(this.batch, entry)
    if (this.context.rulesOnly === true) return
    const sessionId = str(entry.sessionId)
    if (sessionId !== null) this.noteSession(sessionId, entry)
    const uuid = str(entry.uuid)
    if (uuid === null) return

    this.batch.lines.set(uuid, {
      uuid,
      sessionId,
      agentId: str(entry.agentId),
      type: str(entry.type),
      at: str(entry.timestamp),
      raw: compact(entry),
    })
    if (entry.type === 'assistant') this.pushAssistant(entry, sessionId)
    else if (entry.type === 'user') this.pushUser(entry)
  }

  private pushAssistant(entry: Entry, sessionId: string | null): void {
    const message = entry.message
    const id = str(message?.id)
    if (id === null || entry.isApiErrorMessage === true || message?.model === '<synthetic>') return
    const task = this.taskOf(entry, sessionId)

    const usage = message?.usage
    if (usage !== undefined) this.addMessage(entry, id, sessionId, task, usage)

    for (const block of blocksOf(message?.content)) {
      if (block.type !== 'tool_use' || typeof block.id !== 'string' || typeof block.name !== 'string') continue
      const input = block.input ?? {}
      this.batch.calls.set(block.id, {
        toolUseId: block.id,
        sessionId,
        messageId: id,
        task,
        name: block.name,
        inputHash: createHash('sha1').update(JSON.stringify(input)).digest('hex'),
        brief: cleanText(describeTool(block.name, input, entry.cwd)),
        at: str(entry.timestamp),
      })
    }
  }

  private addMessage(entry: Entry, id: string, sessionId: string | null, task: string | null, usage: Usage): void {
    const written = usage.cache_creation
    const write5m = written === undefined ? (usage.cache_creation_input_tokens ?? 0) : (written.ephemeral_5m_input_tokens ?? 0)
    const place = placeOf(entry.cwd)
    const row: MessageRow = {
      messageId: id,
      sessionId,
      agentId: str(entry.agentId),
      account: this.context.account,
      project: place.project,
      projectDir: place.dir,
      task,
      branch: str(entry.gitBranch),
      entrypoint: str(entry.entrypoint),
      model: str(entry.message?.model),
      speed: str(usage.speed),
      effort: str(entry.effort),
      at: str(entry.timestamp),
      input: usage.input_tokens ?? 0,
      cacheWrite5m: write5m,
      cacheWrite1h: written?.ephemeral_1h_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
    }
    const known = this.batch.messages.get(id)
    this.batch.messages.set(id, known === undefined ? row : mergeMessages(known, row))
  }

  private pushUser(entry: Entry): void {
    for (const block of blocksOf(entry.message?.content)) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      const isError = block.is_error === true
      const text = isError ? resultText(block) : null
      this.batch.results.set(block.tool_use_id, {
        toolUseId: block.tool_use_id,
        resultAt: str(entry.timestamp),
        isError,
        errorKind: text === null ? null : errorKindOf(text),
        errorText: text === null ? null : cleanText(text.slice(0, ERROR_TEXT_LIMIT)),
      })
    }
  }

  private noteSession(sessionId: string, entry: Entry): void {
    let row = this.batch.sessions.get(sessionId)
    if (row === undefined) {
      const launch = this.context.launches.get(sessionId)
      row = {
        sessionId,
        account: this.context.account,
        project: null,
        customTitle: null,
        aiTitle: null,
        launchTask: launch?.task ?? null,
        launchReason: launch?.reason ?? null,
        firstAt: null,
        lastAt: null,
      }
      this.batch.sessions.set(sessionId, row)
    }
    row.project ??= placeOf(entry.cwd).project
    if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') row.customTitle = cleanText(entry.customTitle)
    if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') row.aiTitle = cleanText(entry.aiTitle)
    const at = str(entry.timestamp)
    if (at !== null && entry.uuid !== undefined) {
      if (row.firstAt === null || at < row.firstAt) row.firstAt = at
      if (row.lastAt === null || at > row.lastAt) row.lastAt = at
    }
  }

  private taskOf(entry: Entry, sessionId: string | null): string | null {
    const launch = sessionId === null ? undefined : this.context.launches.get(sessionId)
    return taskOf({ launch: launch?.task, branch: entry.gitBranch, cwd: entry.cwd })
  }
}

export function errorKindOf(text: string): ErrorKind {
  if (DENIED.some((pattern) => pattern.test(text))) return 'denied'
  if (HOOK.test(text)) return 'hook'
  return 'error'
}

export function resultText(block: ContentBlock): string {
  if (typeof block.content === 'string') return block.content
  return blocksOf(block.content)
    .map((item) => (typeof item.text === 'string' ? item.text : ''))
    .filter((item) => item !== '')
    .join('\n')
}

function mergeMessages(known: MessageRow, next: MessageRow): MessageRow {
  return {
    ...known,
    at: known.at === null || (next.at !== null && next.at < known.at) ? next.at : known.at,
    input: Math.max(known.input, next.input),
    cacheWrite5m: Math.max(known.cacheWrite5m, next.cacheWrite5m),
    cacheWrite1h: Math.max(known.cacheWrite1h, next.cacheWrite1h),
    cacheRead: Math.max(known.cacheRead, next.cacheRead),
    output: Math.max(known.output, next.output),
    speed: next.speed ?? known.speed,
    effort: next.effort ?? known.effort,
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
