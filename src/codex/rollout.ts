import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LimitWindow, RateLimits } from '../limits/model.js'
import { chatGptCredits } from '../limits/overage.js'
import { describeTool, flatten, lineCount, type EditSize, type TranscriptImage } from '../sessions/entry.js'
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
import { rolloutImagePath, rolloutImages } from './rolloutImages.js'

/**
 * A Codex session's transcript: `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`, lines
 * `{timestamp, type, payload}` (codex-cli 0.162.1). The fold reads `session_meta`, `turn_context` and the `event_msg`
 * lines; `response_item` adds tool-result pictures and mailbox messages absent from those events.
 */
const FEED_SIZE = 30
const TEXT_LIMIT = 500
const MESSAGE_LIMIT = 6000
const SHELL = 'Shell'
const LIMIT_TEXT = /usage limit|rate limit|quota/i
// An OpenAI key out of money: the API's 429 `insufficient_quota`, which codex-cli 0.162.1 words as its `QuotaExceeded`.
const CREDIT_TEXT = /quota exceeded|exceeded your current quota|insufficient_quota/i
const STAGE_RANK: Record<Stage, number> = { task: 0, recon: 1, edit: 2, test: 3, commit: 4, merge: 5 }
const FIVE_HOURS = 300
const WEEK = 10_080
const MONTH = 43_200
const ROLLOUT = /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

interface Line {
  timestamp?: string
  type?: string
  payload?: Record<string, unknown>
}

export class RolloutFold {
  private feed: FeedLine[] = []
  private action: FeedLine | null = null
  private stage: Stage | null = null
  private contextTokens = 0
  private contextWindow: number | null = null
  private compactions = 0
  private tokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  private apiError: TranscriptSummary['apiError'] = null
  private lastMessage: string | null = null
  private checkpoint: string | null = null
  private pullRequest: string | null = null
  private noChanges: string | null = null
  private firstActivityAt: string | null = null
  private lastActivityAt: string | null = null
  private lastReplyAt: string | null = null
  private gitBranch: string | null = null
  private workdir: string | null = null
  private model: string | null = null
  private turnStartedAt: string | null = null
  private endedTurn: string | null = null
  private readonly mailSeen = new Set<number>()
  private readonly imagePaths = new Map<string, string>()

  /** `whole` keeps texts and prompts as written and adds shell commands to tool lines. */
  constructor(
    private readonly feedSize = FEED_SIZE,
    private readonly whole = false,
  ) {}

  push(text: string): void {
    const line = parseLine(text)
    const payload = line?.payload
    if (line === undefined || payload === undefined) return
    if (line.type === 'session_meta') {
      const branch = record(payload.git)?.branch
      if (typeof branch === 'string' && branch !== '') this.gitBranch = branch
      if (typeof payload.cwd === 'string') this.workdir = payload.cwd
      return
    }
    if (line.type === 'turn_context') {
      if (typeof payload.cwd === 'string') this.workdir = payload.cwd
      if (typeof payload.model === 'string' && payload.model !== '') this.model = payload.model
      return
    }
    // A compaction writes its summary as a line of its own, the history to resume from; the event that announces it may follow.
    if (line.type === 'compacted') {
      this.compactions++
      return
    }
    const at = line.timestamp ?? ''
    // A hook's `additionalContext` reaches the rollout only as a developer message, with no event of its own.
    if (line.type === 'response_item' && payload.type === 'message' && payload.role === 'developer') {
      this.pushMail(at, textOf(payload.content))
      return
    }
    if (line.type === 'response_item' && this.whole) this.pushImages(at, payload)
    if (line.type !== 'event_msg') return
    if (payload.type === 'task_started') {
      this.turnStartedAt = at
      this.pushWindow(payload.model_context_window)
    } else if (payload.type === 'token_count') this.pushTokens(record(payload.info))
    else if (payload.type === 'error') this.pushError(at, errorText(payload.message), payload.codex_error_info)
    else if (payload.type === 'task_complete') {
      if (typeof payload.turn_id === 'string') this.endedTurn = payload.turn_id
      if (record(payload.error) !== undefined) this.pushError(at, errorText(record(payload.error)?.message), record(payload.error)?.codex_error_info)
    } else if (payload.type === 'item_completed') this.pushItem(at, record(payload.item), this.endedTurn !== null && payload.turn_id === this.endedTurn)
  }

  summary(): TranscriptSummary {
    return {
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      compactions: this.compactions,
      cache: null,
      tokens: { ...this.tokens },
      turn: this.turnStartedAt === null ? null : { startedAt: this.turnStartedAt, tool: null },
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
      gitBranch: this.gitBranch,
      workdir: this.workdir,
      model: this.model,
    }
  }

  private pushTokens(info: Record<string, unknown> | undefined): void {
    const last = record(info?.last_token_usage)
    const total = record(info?.total_token_usage)
    if (last !== undefined) this.contextTokens = count(last.input_tokens)
    this.pushWindow(info?.model_context_window)
    if (total === undefined) return
    const cached = count(total.cached_input_tokens)
    this.tokens = {
      input: count(total.input_tokens) - cached,
      output: count(total.output_tokens),
      cacheRead: cached,
      cacheWrite: count(total.cache_write_input_tokens),
    }
  }

  private pushWindow(value: unknown): void {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) this.contextWindow = value
  }

  private pushImages(at: string, payload: Record<string, unknown>): void {
    if (typeof payload.call_id !== 'string') return
    if (payload.type === 'custom_tool_call' || payload.type === 'function_call') {
      const path = rolloutImagePath(payload)
      if (path !== '') this.imagePaths.set(payload.call_id, path)
      return
    }
    if (payload.type !== 'custom_tool_call_output' && payload.type !== 'function_call_output') return
    const text = this.imagePaths.get(payload.call_id) ?? ''
    this.imagePaths.delete(payload.call_id)
    const images = rolloutImages(payload).length
    if (images > 0) this.addFeed({ at, kind: 'image', text, tool: payload.call_id, images })
  }

  private pushError(at: string, message: unknown, code?: unknown): void {
    const text = flatten(typeof message === 'string' ? message : 'error', TEXT_LIMIT)
    this.touch(at)
    const transient = isTransientError(text) || (typeof code === 'string' && isTransientError(code))
    this.apiError = { kind: CREDIT_TEXT.test(text) ? 'credit' : transient ? 'transient' : LIMIT_TEXT.test(text) ? 'limit' : 'error', text, at }
    this.addFeed({ at, kind: 'error', text })
  }

  /** `tail` marks an item of a turn that has already ended, such as a command its end killed: it keeps the turn's error and marks. */
  private pushItem(at: string, item: Record<string, unknown> | undefined, tail: boolean): void {
    if (item === undefined || item.type === 'Reasoning') return
    this.touch(at)
    if (item.type === 'HookPrompt') {
      this.pushMail(at, textOf(item.fragments))
      return
    }
    if (item.type === 'UserMessage') {
      if (this.pushMail(at, textOf(item.content))) return
      this.checkpoint = null
      this.pullRequest = null
      this.noChanges = null
      this.apiError = null
      const line = userLine(at, textOf(item.content), null, (text) => this.textOf(text))
      if (line !== null) this.addFeed(line)
      return
    }
    if (!tail) this.apiError = null
    this.lastReplyAt = at
    if (item.type === 'AgentMessage') {
      const message = textOf(item.content)
      const text = this.textOf(message)
      if (text === '') return
      this.addAction({ at, kind: 'text', text })
      this.lastMessage = message.trim().slice(0, MESSAGE_LIMIT)
      this.checkpoint = checkpointOf(message)
      this.pullRequest = pullRequestOf(message)
      this.noChanges = noChangesOf(message)
      return
    }
    if (!tail) {
      this.checkpoint = null
      this.pullRequest = null
      this.noChanges = null
    }
    if (item.type === 'CommandExecution') {
      const command = commandOf(item.command)
      const startedAt = typeof item.started_at_ms === 'number' && Number.isFinite(item.started_at_ms) ? new Date(item.started_at_ms).toISOString() : at
      const line: FeedLine = { at: startedAt, kind: 'tool', text: describeTool(SHELL, { command }, undefined) }
      if (this.whole) Object.assign(line, { detail: command, ...this.callOf(item, SHELL, {}) })
      this.action = line
      this.addFeedByTime(line)
      this.advanceStage(stageOfCommand(command))
    } else if (item.type === 'FileChange') {
      for (const [path, change] of Object.entries(record(item.changes) ?? {})) {
        const line: FeedLine = { at, kind: 'tool', text: describeTool('Edit', { file_path: path }, this.workdir ?? undefined) }
        if (this.whole) Object.assign(line, this.callOf(item, 'Edit', { file_path: path }, changeSize(record(change))))
        this.addAction(line)
      }
      this.advanceStage('edit')
    } else if (typeof item.server === 'string' && typeof item.tool === 'string') {
      const name = `mcp__${item.server}__${item.tool}`
      const input = record(item.arguments) ?? {}
      const line: FeedLine = { at, kind: 'tool', text: describeTool(name, input, undefined) }
      if (this.whole) Object.assign(line, this.callOf(item, name, input))
      this.addAction(line)
      if (item.tool === 'get_issue') this.advanceStage('task')
    } else {
      return
    }
    if (this.whole && item.status === 'failed') {
      const interrupted = tail && item.type === 'CommandExecution' && item.exit_code === -1
      this.addFeed({ at, kind: 'failed', text: failureText(failureOf(item)), ...(interrupted ? { interrupted: true } : {}), ...(typeof item.id === 'string' ? { tool: item.id } : {}) })
    }
  }

  /** The chat's messages a hook of the mailbox gave the session, as the user's prompts, each id once; whether `text` held any. */
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

  /** The facts of a whole transcript's tool line; the rollout writes a call once it has finished, so it knows its outcome. */
  private callOf(item: Record<string, unknown>, name: string, input: Record<string, unknown>, size?: EditSize): Partial<FeedLine> {
    return { ...callFacts(name, input, size), ...(typeof item.id === 'string' ? { tool: item.id } : {}) }
  }

  private touch(at: string): void {
    if (at === '') return
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

  /** A line goes after the last one that is not later than it: a command killed by the end of the turn is written after the turn's error but started before it. */
  private addFeedByTime(line: FeedLine): void {
    let index = this.feed.length
    while (index > 0 && line.at !== '' && this.feed[index - 1]!.at > line.at) index--
    this.feed.splice(index, 0, line)
    if (this.feed.length > this.feedSize) this.feed = this.feed.slice(-this.feedSize)
  }

  private advanceStage(next: Stage | undefined): void {
    if (next === undefined) return
    if (this.stage === null || STAGE_RANK[next] >= STAGE_RANK.edit || STAGE_RANK[next] > STAGE_RANK[this.stage]) this.stage = next
  }
}

/** The session id a rollout's first line (`session_meta`) names. */
export function rolloutSessionId(text: string): string | undefined {
  const line = parseLine(text)
  return line?.type === 'session_meta' && typeof line.payload?.id === 'string' ? line.payload.id : undefined
}

/**
 * The account's limits as of its newest `token_count` with `rate_limits` that has a window: the 300-minute window is
 * the five-hour one, the 10080-minute window the weekly one, the 43200-minute window (the free plan's) the month; a
 * window of another length is not shown. The `premium` limits without windows that codex-cli 0.164.0 writes before a
 * turn refused by the limit are passed over: taken, they would wipe the spent window.
 */
export function limitsOfRollout(text: string): RateLimits | undefined {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = parseLine(lines[index]!)
    const limits = record(line?.payload?.rate_limits)
    if (line?.type !== 'event_msg' || line.payload?.type !== 'token_count' || limits === undefined) continue
    const windows = [record(limits.primary), record(limits.secondary)]
    if (windows.every((window) => window === undefined)) continue
    const monthly = windows.some((window) => window?.window_minutes === MONTH)
    const at = new Date(Date.parse(line.timestamp ?? '') || 0).toISOString()
    const overage = chatGptCredits(limits.credits, at)
    return {
      fiveHour: windowOf(windows, FIVE_HOURS),
      sevenDay: windowOf(windows, WEEK),
      ...(monthly ? { month: windowOf(windows, MONTH) } : {}),
      updatedAt: at,
      source: 'usage',
      ...(overage !== undefined && { overage }),
    }
  }
  return undefined
}

/** The rollout files of a Codex folder, newest first. */
export async function rolloutFiles(home: string): Promise<{ id: string; file: string }[]> {
  const found: { id: string; file: string }[] = []
  const root = join(home, 'sessions')
  for (const year of await newestFirst(root)) {
    for (const month of await newestFirst(join(root, year))) {
      for (const day of await newestFirst(join(root, year, month))) {
        for (const name of await newestFirst(join(root, year, month, day))) {
          const id = ROLLOUT.exec(name)?.[1]
          if (id !== undefined) found.push({ id, file: join(root, year, month, day, name) })
        }
      }
    }
  }
  return found
}

export async function rolloutFile(home: string, sessionId: string): Promise<string | undefined> {
  return (await rolloutFiles(home)).find((rollout) => rollout.id === sessionId)?.file
}

/** Folds a whole rollout; `undefined` — the folder has no such session. */
export async function foldRollout(home: string, sessionId: string, fold: RolloutFold): Promise<TranscriptSummary | undefined> {
  const file = await rolloutFile(home, sessionId)
  if (file === undefined) return undefined
  for (const line of (await readFile(file, 'utf8')).split('\n')) fold.push(line)
  return fold.summary()
}

/** Picture `index` of call `tool`, kept in the rollout even when its original file is gone. */
export async function readRolloutImage(home: string, sessionId: string, tool: string, index: number): Promise<TranscriptImage | undefined> {
  const file = await rolloutFile(home, sessionId)
  if (file === undefined) return undefined
  for (const text of (await readFile(file, 'utf8')).split('\n')) {
    const line = parseLine(text)
    if (line?.type !== 'response_item' || line.payload?.call_id !== tool) continue
    const images = rolloutImages(line.payload)
    if (images.length > 0) return images[index]
  }
  return undefined
}

async function newestFirst(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [])).sort().reverse()
}

function windowOf(windows: (Record<string, unknown> | undefined)[], minutes: number): LimitWindow | null {
  const window = windows.find((candidate) => candidate?.window_minutes === minutes)
  if (window === undefined || typeof window.used_percent !== 'number' || typeof window.resets_at !== 'number') return null
  return { usedPercentage: window.used_percent, resetsAt: new Date(window.resets_at * 1000).toISOString() }
}

/** `["pwsh.exe", "-Command", "git status"]`: the last element is the command the shell runs. */
function commandOf(command: unknown): string {
  if (typeof command === 'string') return command
  return Array.isArray(command) && typeof command.at(-1) === 'string' ? (command.at(-1) as string) : ''
}

/**
 * The lines of one file of a `FileChange`: an `add` or a `delete` carries the file's `content`, an `update` its
 * `unified_diff`; no size when neither is there.
 */
function changeSize(change: Record<string, unknown> | undefined): EditSize | undefined {
  if (typeof change?.content === 'string') {
    const lines = lineCount(change.content)
    return change.type === 'delete' ? { added: 0, removed: lines } : { added: lines, removed: 0 }
  }
  if (typeof change?.unified_diff !== 'string') return undefined
  const lines = change.unified_diff.split(/\r?\n/)
  return {
    added: lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length,
    removed: lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length,
  }
}

/**
 * What a failed call printed: a command's output, a patch's error. A command's exit code goes first, as Claude's
 * `Exit code N` does: its output alone may be an ordinary one (BTN-233). `-1` is a command that never started or one
 * the end of its turn killed mid-work.
 */
function failureOf(item: Record<string, unknown>): string {
  const output = [item.stderr, item.aggregated_output, item.stdout].find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? ''
  return typeof item.exit_code === 'number' ? `Exit code ${item.exit_code}\n${output}` : output
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => record(block))
    .filter((block) => typeof block?.text === 'string')
    .map((block) => block!.text as string)
    .join('\n\n')
}

function parseLine(text: string): Line | undefined {
  if (text.trim() === '') return undefined
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? (value as Line) : undefined
  } catch {
    return undefined
  }
}

/** The message of a failed turn is often the API's JSON answer as a string: its inner `error.message` is what a human reads. */
function errorText(message: unknown): unknown {
  if (typeof message !== 'string' || !message.trimStart().startsWith('{')) return message
  try {
    const inner = record(record(JSON.parse(message))?.error)?.message
    return typeof inner === 'string' && inner !== '' ? inner : message
  } catch {
    return message
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function count(value: unknown): number {
  return typeof value === 'number' ? value : 0
}
