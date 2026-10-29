import { ttlWithin } from '../sessions/cache.js'
import { describeTool, diffSize, flatten, lineCount, type EditSize } from '../sessions/entry.js'
import { mailIn } from '../sessions/mail.js'
import { isTransientError } from '../sessions/transient.js'
import {
  callFacts,
  checkpointOf,
  failureText,
  noChangesOf,
  pullRequestOf,
  stageOfCommand,
  userLine,
  type ApiErrorKind,
  type CacheWindow,
  type FeedLine,
  type Stage,
  type TokenTotals,
  type TranscriptSummary,
} from '../sessions/transcript.js'

/**
 * A Copilot session's transcript: `session-state/<id>/events.jsonl` of the account folder (Copilot CLI 1.0.98), a line
 * per event `{ type, data, id, timestamp, parentId }`, a resume appending to the same file. A user request
 * (`user.message`) takes several model turns (`assistant.turn_start`/`turn_end`), each with its `session.usage_record`
 * and `assistant.message`, whose `toolRequests` run as `tool.execution_start`/`complete`. An event of a subagent
 * carries `agentId`: only its tokens count (`docs/sessions.md`).
 */
const FEED_SIZE = 30
const TEXT_LIMIT = 500
const MESSAGE_LIMIT = 6000
const SHELL = 'Shell'
const LIMIT_TEXT = /rate limit|quota|premium request|too many requests/i
const CREDIT_TEXT = /billing|ai credits|budget/i
const STAGE_RANK: Record<Stage, number> = { task: 0, recon: 1, edit: 2, test: 3, commit: 4, merge: 5 }
/** `session.error`'s `errorType`: a rate limit and a spent quota wait for their reset, `billing_not_configured` does not. */
const ERROR_KINDS: Record<string, ApiErrorKind> = { rate_limit: 'limit', quota: 'limit' }

/** Copilot's own tools as Claude Code names them, with the input keys the feed reads. */
const TOOLS: Record<string, { name: string; keys: Record<string, string> }> = {
  powershell: { name: SHELL, keys: {} },
  bash: { name: SHELL, keys: {} },
  view: { name: 'Read', keys: { path: 'file_path' } },
  edit: { name: 'Edit', keys: { path: 'file_path', old_str: 'old_string', new_str: 'new_string' } },
  create: { name: 'Write', keys: { path: 'file_path', file_text: 'content' } },
  glob: { name: 'Glob', keys: {} },
  grep: { name: 'Grep', keys: {} },
  rg: { name: 'Grep', keys: {} },
  web_fetch: { name: 'WebFetch', keys: {} },
  skill: { name: 'Skill', keys: {} },
  task: { name: 'Task', keys: {} },
}
/** Copilot's own tools whose names hold a dash; any other name with one is `<server>-<tool>` of an MCP server. */
const OWN_TOOLS = new Set([...Object.keys(TOOLS), 'apply_patch', 'read_powershell', 'write_powershell', 'stop_powershell', 'list_powershell', 'read_bash', 'write_bash', 'stop_bash', 'list_bash'])
const EDITS = new Set(['edit', 'create', 'apply_patch'])

type Json = Record<string, unknown>

/** `whole` keeps texts and prompts as written and adds the call facts and the failed lines to the feed. */
export function foldEvents(text: string, feedSize = FEED_SIZE, whole = false): TranscriptSummary {
  const fold = new CopilotFold(feedSize, whole)
  for (const line of text.split('\n')) fold.push(line)
  return fold.summary()
}

export class CopilotFold {
  private feed: FeedLine[] = []
  private action: FeedLine | null = null
  private stage: Stage | null = null
  private contextTokens = 0
  private contextWindow: number | null = null
  private cache: CacheWindow | null = null
  private tokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  private apiError: TranscriptSummary['apiError'] = null
  private lastMessage: string | null = null
  private checkpoint: string | null = null
  private pullRequest: string | null = null
  private noChanges: string | null = null
  private firstActivityAt: string | null = null
  private lastActivityAt: string | null = null
  private lastReplyAt: string | null = null
  private workdir: string | null = null
  private branch: string | null = null
  private model: string | null = null
  private turnStartedAt: string | null = null
  /** The calls started and not completed, by id, with their feed text. */
  private readonly running = new Map<string, string>()
  private readonly mailSeen = new Set<number>()

  constructor(
    private readonly feedSize = FEED_SIZE,
    private readonly whole = false,
  ) {}

  push(text: string): void {
    const event = parse(text)
    if (event === undefined || typeof event.type !== 'string' || typeof event.timestamp !== 'string') return
    const data = record(event.data) ?? {}
    const at = event.timestamp
    if (event.type === 'session.usage_record') this.pushUsage(data, event.agentId === undefined, at)
    if (event.agentId !== undefined) return
    switch (event.type) {
      case 'session.start':
      case 'session.resume':
        this.pushContext(record(data.context))
        return
      case 'session.auto_mode_resolved':
        if (typeof data.chosenModel === 'string') this.model = data.chosenModel
        return
      case 'user.message':
        this.touch(at)
        this.pushPrompt(at, typeof data.content === 'string' ? data.content : '')
        return
      case 'assistant.message':
        this.touch(at)
        this.pushMessage(at, data)
        return
      case 'tool.execution_complete':
        this.touch(at)
        this.pushResult(at, data)
        return
      case 'session.error':
        this.touch(at)
        this.pushError(at, data)
        return
      case 'abort':
        this.running.clear()
        return
    }
  }

  summary(): TranscriptSummary {
    return {
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      compactions: 0,
      cache: this.cache,
      tokens: { ...this.tokens },
      turn: this.turnStartedAt === null ? null : { startedAt: this.turnStartedAt, tool: [...this.running.values()].at(-1) ?? null },
      action: this.action,
      stage: this.stage,
      feed: [...this.feed],
      remoteUrl: null,
      remoteLost: false,
      apiError: this.apiError,
      lastMessage: this.lastMessage,
      checkpoint: this.checkpoint,
      pullRequest: this.pullRequest,
      noChanges: this.noChanges,
      asking: false,
      ask: null,
      firstActivityAt: this.firstActivityAt,
      lastActivityAt: this.lastActivityAt,
      lastReplyAt: this.lastReplyAt,
      gitBranch: this.branch,
      workdir: this.workdir,
      model: this.model,
    }
  }

  private pushContext(context: Json | undefined): void {
    if (typeof context?.cwd === 'string') this.workdir = context.cwd
    if (typeof context?.branch === 'string' && context.branch !== '') this.branch = context.branch
  }

  /**
   * A model call's tokens: `inputTokens` is the whole prompt, the cache read and write included, so it is the context;
   * `outputTokens` holds the reasoning. A subagent's calls count in the totals only. `cacheExpiresAt` is the cache's
   * end counted from the call's start, `duration` before the record; a call without it leaves the cache unknown.
   */
  private pushUsage(data: Json, own: boolean, at: string): void {
    const usage = record(data.usage)
    if (usage === undefined) return
    const prompt = count(usage.inputTokens)
    const read = count(usage.cacheReadTokens)
    const write = count(usage.cacheWriteTokens)
    this.tokens = {
      input: this.tokens.input + Math.max(0, prompt - read - write),
      output: this.tokens.output + count(usage.outputTokens),
      cacheRead: this.tokens.cacheRead + read,
      cacheWrite: this.tokens.cacheWrite + write,
    }
    if (!own) return
    const until = typeof usage.cacheExpiresAt === 'string' ? Date.parse(usage.cacheExpiresAt) : NaN
    this.cache = Number.isNaN(until) ? null : { ttl: ttlWithin(until - Date.parse(at) + count(usage.duration)), until: new Date(until).toISOString() }
    if (prompt > 0) this.contextTokens = prompt
    if (count(usage.maxPromptTokens) > 0) this.contextWindow = count(usage.maxPromptTokens)
    if (typeof usage.model === 'string' && usage.model !== '') this.model = usage.model
  }

  private pushPrompt(at: string, text: string): void {
    if (this.pushMail(at, text)) return
    this.turnStartedAt = at
    this.running.clear()
    this.checkpoint = null
    this.pullRequest = null
    this.noChanges = null
    this.apiError = null
    const line = userLine(at, text, null, (each) => this.textOf(each))
    if (line !== null) this.addFeed(line)
  }

  private pushMessage(at: string, data: Json): void {
    if (typeof data.model === 'string' && data.model !== '') this.model = data.model
    const content = typeof data.content === 'string' ? data.content : ''
    const calls = Array.isArray(data.toolRequests) ? data.toolRequests.map(record).filter((call): call is Json => call !== undefined) : []
    if (content.trim() !== '') this.pushText(at, content)
    for (const call of calls) this.pushCall(at, call)
  }

  private pushText(at: string, content: string): void {
    this.lastReplyAt = at
    if (this.pushMail(at, content)) return
    const text = this.textOf(content)
    if (text === '') return
    this.apiError = null
    this.addAction({ at, kind: 'text', text })
    this.lastMessage = content.trim().slice(0, MESSAGE_LIMIT)
    this.checkpoint = checkpointOf(content)
    this.pullRequest = pullRequestOf(content)
    this.noChanges = noChangesOf(content)
  }

  private pushCall(at: string, call: Json): void {
    const tool = typeof call.name === 'string' ? call.name : ''
    if (tool === '') return
    this.lastReplyAt = at
    this.apiError = null
    this.checkpoint = null
    this.pullRequest = null
    this.noChanges = null
    const id = typeof call.toolCallId === 'string' ? call.toolCallId : undefined
    const lines = tool === 'apply_patch' ? patchCalls(call.arguments) : [claudeCall(tool, record(call.arguments) ?? {})]
    for (const { name, input, size } of lines) {
      const line: FeedLine = { at, kind: 'tool', text: describeTool(name, input, this.workdir ?? undefined) }
      if (name === SHELL && typeof input.command === 'string') {
        if (this.whole) line.detail = input.command
        this.advanceStage(stageOfCommand(input.command))
      } else if (EDITS.has(tool)) this.advanceStage('edit')
      else if (name.startsWith('mcp__') && name.endsWith('get_issue')) this.advanceStage('task')
      if (this.whole) Object.assign(line, callFacts(name, input, size ?? sizeOf(tool, record(call.arguments) ?? {})), id === undefined ? {} : { tool: id })
      this.addAction(line)
      if (id !== undefined) this.running.set(id, line.text)
    }
  }

  private pushResult(at: string, data: Json): void {
    const id = typeof data.toolCallId === 'string' ? data.toolCallId : undefined
    if (id !== undefined) this.running.delete(id)
    if (!this.whole || data.success !== false) return
    const error = record(data.error)
    const result = record(data.result)
    const exit = record(data.shellExecution)?.exitCode
    const output = typeof error?.message === 'string' ? error.message : typeof result?.content === 'string' ? result.content : ''
    const text = typeof exit === 'number' ? `Exit code ${exit}\n${output}` : output
    this.addFeed({ at, kind: 'failed', text: failureText(text), ...(id === undefined ? {} : { tool: id }) })
  }

  private pushError(at: string, data: Json): void {
    const message = typeof data.message === 'string' && data.message !== '' ? data.message : typeof data.errorType === 'string' ? data.errorType : 'error'
    const brief = flatten(message, TEXT_LIMIT)
    const known = typeof data.errorType === 'string' ? ERROR_KINDS[data.errorType] : undefined
    const transient = isTransientError(`${message} ${data.errorType ?? ''} ${data.errorCode ?? ''}`)
    const kind = data.errorCode === 'billing_not_configured' || CREDIT_TEXT.test(brief) ? 'credit' : transient ? 'transient' : (known ?? (LIMIT_TEXT.test(brief) ? 'limit' : 'error'))
    this.apiError = { kind, text: brief, at }
    this.running.clear()
    this.addFeed({ at, kind: 'error', text: brief })
  }

  /** The chat's messages handed to the session, as the user's prompts, each id once; whether `text` held any. */
  private pushMail(at: string, text: string): boolean {
    const found = mailIn(text)
    for (const { id, prompt } of found) {
      if (this.mailSeen.has(id)) continue
      this.mailSeen.add(id)
      const line = userLine(at, prompt, null, (each) => this.textOf(each))
      if (line !== null) this.addFeed(line)
    }
    return found.length > 0
  }

  private touch(at: string): void {
    this.firstActivityAt ??= at
    this.lastActivityAt = at
  }

  private textOf(text: string): string {
    return this.whole ? text.trim() : flatten(text, TEXT_LIMIT)
  }

  private addAction(line: FeedLine): void {
    this.action = line
    this.addFeed(line)
  }

  private addFeed(line: FeedLine): void {
    this.feed.push(line)
    if (this.feed.length > this.feedSize) this.feed = this.feed.slice(-this.feedSize)
  }

  private advanceStage(next: Stage | undefined): void {
    if (next === undefined) return
    if (this.stage === null || STAGE_RANK[next] >= STAGE_RANK.edit || STAGE_RANK[next] > STAGE_RANK[this.stage]) this.stage = next
  }
}

interface Call {
  name: string
  input: Json
  size?: EditSize
}

/**
 * A call as the feed knows it: Copilot's tool under Claude Code's name, its input under Claude Code's keys. An MCP
 * tool is `<server>-<tool>`, the server's name the one it was given (the gateway's `plugin_<plugin>_<server>`).
 */
export function claudeCall(tool: string, input: Json): Call {
  const known = TOOLS[tool]
  if (known !== undefined) return { name: known.name, input: Object.fromEntries(Object.entries(input).map(([key, value]) => [known.keys[key] ?? key, value])) }
  const dash = tool.lastIndexOf('-')
  if (OWN_TOOLS.has(tool) || dash <= 0) return { name: tool, input }
  return { name: `mcp__${tool.slice(0, dash)}__${tool.slice(dash + 1)}`, input }
}

/** `apply_patch` takes the patch as text: a line per file it adds, updates or deletes, each with its size. */
export function patchCalls(patch: unknown): Call[] {
  if (typeof patch !== 'string') return [{ name: 'Edit', input: {} }]
  const calls: Call[] = []
  let size: EditSize | undefined
  for (const line of patch.split(/\r?\n/)) {
    const file = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line)
    if (file !== null) {
      size = { added: 0, removed: 0 }
      calls.push({ name: file[1] === 'Add' ? 'Write' : 'Edit', input: { file_path: file[2]!.trim() }, size })
      continue
    }
    if (size === undefined || line.startsWith('***')) continue
    if (line.startsWith('+')) size.added++
    else if (line.startsWith('-')) size.removed++
  }
  return calls.length > 0 ? calls : [{ name: 'Edit', input: {} }]
}

function sizeOf(tool: string, input: Json): EditSize | undefined {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  if (tool === 'edit') return diffSize(text(input.old_str), text(input.new_str))
  if (tool === 'create') return { added: lineCount(text(input.file_text)), removed: 0 }
  return undefined
}

function parse(text: string): Json | undefined {
  if (text.trim() === '') return undefined
  try {
    return record(JSON.parse(text))
  } catch {
    return undefined
  }
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function count(value: unknown): number {
  return typeof value === 'number' ? value : 0
}
