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
  type FeedLine,
  type Stage,
  type TokenTotals,
  type TranscriptSummary,
} from '../sessions/transcript.js'
import type { TurnError } from './cli.js'

/**
 * An OpenCode session's transcript: the rows of tables `message` and `part` of `opencode.db` (OpenCode 1.18.25), each
 * with its JSON `data`. A message is the user's prompt or one step of the model's answer; its parts are the texts, the
 * tool calls (`state.status` `pending`, `running`, `completed`, `error`) and the step marks. A killed turn leaves its
 * tool part `running` and its message without `time.completed` for good (`docs/sessions.md`).
 */
export interface MessageRow {
  id: string
  at: number
  data: string
}

export interface PartRow {
  id: string
  message: string
  at: number
  data: string
}

const FEED_SIZE = 30
const TEXT_LIMIT = 500
const MESSAGE_LIMIT = 6000
const SHELL = 'Shell'
const LIMIT_TEXT = /usage limit|rate limit|quota|too many requests/i
const LIMIT_TYPE = /FreeUsageLimitError/
const CREDIT_TEXT =/insufficient_quota|exceeded your current quota|credit balance/i
const STAGE_RANK: Record<Stage, number> = { task: 0, recon: 1, edit: 2, test: 3, commit: 4, merge: 5 }

/** OpenCode's own tools as Claude Code names them, with the input keys the feed reads. */
const TOOLS: Record<string, { name: string; keys: Record<string, string> }> = {
  bash: { name: SHELL, keys: {} },
  read: { name: 'Read', keys: { filePath: 'file_path' } },
  edit: { name: 'Edit', keys: { filePath: 'file_path', oldString: 'old_string', newString: 'new_string' } },
  write: { name: 'Write', keys: { filePath: 'file_path' } },
  glob: { name: 'Glob', keys: {} },
  grep: { name: 'Grep', keys: {} },
  webfetch: { name: 'WebFetch', keys: {} },
  websearch: { name: 'WebSearch', keys: {} },
  skill: { name: 'Skill', keys: { name: 'skill' } },
  task: { name: 'Task', keys: {} },
  todowrite: { name: 'TodoWrite', keys: {} },
}
const EDITS = new Set(['edit', 'write', 'patch', 'multiedit'])

type Json = Record<string, unknown>

/**
 * `whole` keeps texts and prompts as written and adds the call facts and the failed lines to the feed. `errors` — those
 * the turns ended on (`OpenCodeCli.turnErrors`), each in its place by time; one a step of the session holds is not repeated.
 */
export function foldSession(messages: MessageRow[], parts: PartRow[], feedSize = FEED_SIZE, whole = false, errors: TurnError[] = []): TranscriptSummary {
  const fold = new SessionFold(feedSize, whole)
  const byMessage = new Map<string, PartRow[]>()
  for (const part of parts) byMessage.set(part.message, [...(byMessage.get(part.message) ?? []), part])
  const ordered = [...messages].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  const held = new Set(
    ordered.flatMap((message) => {
      const error = record(parse(message.data)?.error)
      return error === undefined ? [] : [errorText(error)]
    }),
  )
  const left = errors.filter(({ error }) => !held.has(errorText(error))).sort((a, b) => a.at - b.at)
  ordered.forEach((message, index) => {
    while (left.length > 0 && left[0]!.at < message.at) fold.pushTurnError(left.shift()!)
    const own = (byMessage.get(message.id) ?? []).sort((a, b) => a.id.localeCompare(b.id))
    fold.push(message, own, index === ordered.length - 1)
  })
  for (const error of left) fold.pushTurnError(error)
  return fold.summary()
}

class SessionFold {
  private feed: FeedLine[] = []
  private action: FeedLine | null = null
  private stage: Stage | null = null
  private contextTokens = 0
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
  private model: string | null = null
  private turnStartedAt: string | null = null
  private turnTool: string | null = null
  private readonly mailSeen = new Set<number>()

  constructor(
    private readonly feedSize: number,
    private readonly whole: boolean,
  ) {}

  push(row: MessageRow, parts: PartRow[], last: boolean): void {
    const message = parse(row.data)
    if (message === undefined) return
    const at = iso(row.at)
    this.touch(at)
    if (message.role === 'user') {
      this.pushPrompt(at, parts)
      return
    }
    if (message.role !== 'assistant') return
    this.pushStep(message)
    this.turnTool = null
    for (const part of parts) this.pushPart(part, last)
    const error = record(message.error)
    if (error !== undefined) this.pushError(at, error)
  }

  summary(): TranscriptSummary {
    return {
      contextTokens: this.contextTokens,
      contextWindow: null,
      compactions: 0,
      cache: null,
      tokens: { ...this.tokens },
      turn: this.turnStartedAt === null ? null : { startedAt: this.turnStartedAt, tool: this.turnTool },
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
      gitBranch: null,
      workdir: this.workdir,
      model: this.model,
    }
  }

  private pushPrompt(at: string, parts: PartRow[]): void {
    const text = parts
      .map((part) => parse(part.data))
      .filter((part) => part?.type === 'text' && part.synthetic !== true && typeof part.text === 'string')
      .map((part) => part!.text as string)
      .join('\n\n')
    if (this.pushMail(at, text)) return
    this.turnStartedAt = at
    this.turnTool = null
    this.checkpoint = null
    this.pullRequest = null
    this.noChanges = null
    this.apiError = null
    const line = userLine(at, text, null, (each) => this.textOf(each))
    if (line !== null) this.addFeed(line)
  }

  /** A step's model and tokens: the context is what its request read, the totals add every step up. */
  private pushStep(message: Json): void {
    const path = record(message.path)
    if (typeof path?.cwd === 'string') this.workdir = path.cwd
    if (typeof message.modelID === 'string' && message.modelID !== '') {
      this.model = typeof message.providerID === 'string' && message.providerID !== '' ? `${message.providerID}/${message.modelID}` : message.modelID
    }
    const tokens = record(message.tokens)
    if (tokens === undefined) return
    const cache = record(tokens.cache)
    const read = count(cache?.read)
    const write = count(cache?.write)
    const context = count(tokens.input) + read + write
    if (context > 0) this.contextTokens = context
    this.tokens = {
      input: this.tokens.input + count(tokens.input),
      output: this.tokens.output + count(tokens.output) + count(tokens.reasoning),
      cacheRead: this.tokens.cacheRead + read,
      cacheWrite: this.tokens.cacheWrite + write,
    }
  }

  private pushPart(row: PartRow, last: boolean): void {
    const part = parse(row.data)
    if (part === undefined) return
    const at = iso(row.at)
    if (part.type === 'text' && typeof part.text === 'string' && part.synthetic !== true) {
      this.touch(at)
      this.lastReplyAt = at
      if (this.pushMail(at, part.text)) return
      const text = this.textOf(part.text)
      if (text === '') return
      this.apiError = null
      this.addAction({ at, kind: 'text', text })
      this.lastMessage = part.text.trim().slice(0, MESSAGE_LIMIT)
      this.checkpoint = checkpointOf(part.text)
      this.pullRequest = pullRequestOf(part.text)
      this.noChanges = noChangesOf(part.text)
      return
    }
    if (part.type !== 'tool' || typeof part.tool !== 'string') return
    this.touch(at)
    this.lastReplyAt = at
    this.apiError = null
    this.checkpoint = null
    this.pullRequest = null
    this.noChanges = null
    const state = record(part.state) ?? {}
    const { name, input } = claudeCall(part.tool, record(state.input) ?? {})
    const line: FeedLine = { at, kind: 'tool', text: describeTool(name, input, this.workdir ?? undefined) }
    if (name === SHELL && typeof input.command === 'string') {
      if (this.whole) line.detail = input.command
      this.advanceStage(stageOfCommand(input.command))
    } else if (EDITS.has(part.tool)) this.advanceStage('edit')
    else if (part.tool.endsWith('get_issue')) this.advanceStage('task')
    if (this.whole) Object.assign(line, callFacts(name, input, sizeOf(part.tool, record(state.input) ?? {})), typeof part.callID === 'string' ? { tool: part.callID } : {})
    this.addAction(line)
    // The checkpoint package's plugin keeps what it put after the output in the call's metadata, which no tool writes;
    // the output itself is never read, so a tool that prints the mark from a file fakes no message.
    const mail = record(record(state.metadata)?.evenKeel)?.mail
    if (typeof mail === 'string') this.pushMail(at, mail)
    if (last && (state.status === 'running' || state.status === 'pending')) this.turnTool = line.text
    if (this.whole && state.status === 'error') {
      this.addFeed({ at, kind: 'failed', text: failureText(typeof state.error === 'string' ? state.error : ''), ...(typeof part.callID === 'string' ? { tool: part.callID } : {}) })
    }
  }

  pushTurnError({ at, error }: TurnError): void {
    const when = iso(at)
    this.touch(when)
    this.pushError(when, error)
  }

  private pushError(at: string, error: Json): void {
    const brief = flatten(errorText(error), TEXT_LIMIT)
    const kind = CREDIT_TEXT.test(brief) ? 'credit' : isTransientError(JSON.stringify(error)) ? 'transient' : LIMIT_TEXT.test(brief) || limitError(error) ? 'limit' : 'error'
    this.apiError = { kind, text: brief, at }
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

/** A call as the feed knows it: OpenCode's tool under Claude Code's name, its input under Claude Code's keys. */
function claudeCall(tool: string, input: Json): { name: string; input: Json } {
  const known = TOOLS[tool]
  if (known === undefined) return { name: tool, input }
  return { name: known.name, input: Object.fromEntries(Object.entries(input).map(([key, value]) => [known.keys[key] ?? key, value])) }
}

function sizeOf(tool: string, input: Json): EditSize | undefined {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  if (tool === 'edit') return diffSize(text(input.oldString), text(input.newString))
  if (tool === 'write') return { added: lineCount(text(input.content)), removed: 0 }
  return undefined
}

/** An API error of a step: `{ name, data: { message } }`; the message is often the provider's JSON answer as a string. */
/** A 429, or OpenCode Zen's spent free allowance (`FreeUsageLimitError`) named anywhere in the answer, worded as it may be. */
function limitError(error: Json): boolean {
  return record(error.data)?.statusCode === 429 || LIMIT_TYPE.test(JSON.stringify(error))
}

function errorText(error: Json): string {
  const message = record(error.data)?.message
  const text = typeof message === 'string' && message !== '' ? message : typeof error.name === 'string' ? error.name : 'error'
  if (!text.trimStart().startsWith('{')) return text
  try {
    const inner = record(record(JSON.parse(text))?.error)?.message
    return typeof inner === 'string' && inner !== '' ? inner : text
  } catch {
    return text
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function parse(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return record(value)
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
