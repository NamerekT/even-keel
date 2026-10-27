import { isSpendingLimit } from '../limits/spending.js'
import type { Notice } from '../notice/notice.js'
import { isTransientError } from './transient.js'
import { questionsOf, replyParts, toolAnswers, type Ask, type AskAnswers } from './ask.js'
import { mailIn } from './mail.js'
import {
  blocksOf,
  describeTool,
  editSize,
  flatten,
  imagesOf,
  parseEntry,
  subjectOf,
  type ContentBlock,
  type EditSize,
  type Entry,
  type Usage,
} from './entry.js'
import { remoteUrlOf } from './remote.js'
import { SHARE_TOOL, shareOf, type Share } from './share.js'

export type Stage = 'task' | 'recon' | 'edit' | 'test' | 'commit' | 'merge'
/** `credit` — spent API credit; `spend` — a specified API spending cap, even when the CLI reports `unknown`. */
export type ApiErrorKind = 'limit' | 'credit' | 'spend' | 'transient' | 'error'

const API_ERROR_KINDS = new Map<unknown, ApiErrorKind>([
  ['rate_limit', 'limit'],
  ['billing_error', 'credit'],
  ['overloaded_error', 'transient'],
])

export interface FeedLine {
  at: string
  /** A service diagnostic translated by the page. */
  notice?: Notice
  /** `image` and `failed` only in a whole transcript: the result of call `tool` holds pictures, or is an error. */
  kind: 'text' | 'tool' | 'error' | 'prompt' | 'answer' | 'image' | 'failed'
  /**
   * For a prompt or an answer, only the user's own words: Even Keel's lines around a reply, its answers and files are
   * left out. For an image line, the name of the file the call read, empty for other tools. For a failed line, the error.
   */
  text: string
  /** The whole shell command of a tool line, only in a whole transcript. */
  detail?: string
  /** A failed line of a command that the end of its turn killed, not one that failed on its own. */
  interrupted?: true
  /** The id of the call of a tool line, an image line or a failed line, only in a whole transcript. */
  tool?: string
  /** The tool a tool line calls, only in a whole transcript. */
  name?: string
  /** What the call is about (`subjectOf`), only in a whole transcript. */
  subject?: string
  /** The lines an edit of a tool line adds and removes, only in a whole transcript. */
  added?: number
  removed?: number
  /** How many pictures an image line has; the page fetches them by the call's id, the data stays in the transcript. */
  images?: number
  /** The questions of an `AskUserQuestion` tool line, only in a whole transcript. */
  ask?: Ask
  /** An answer line: the question it answers (unknown for a question the transcript lost) and its answers, by question text. */
  answers?: { ask?: string; answers: AskAnswers }
  /** The paths of the files the user sent along with a prompt or an answer. */
  files?: string[]
  /** The files a `SendUserFile` tool line sent the user, only in a whole transcript; the page fetches them by the call's id. */
  share?: Share
}

export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type CacheTtl = '5m' | '1h'

export interface CacheWindow {
  ttl: CacheTtl
  until: string
}

/** The last turn of a session, begun by the last prompt; whether it still runs is the lamp's call. */
export interface Turn {
  startedAt: string
  /** The tool line of a call that has no result yet; `null` while the model writes or thinks. */
  tool: string | null
}

/** The lines of a whole transcript from some line on, and its last turn for the chat's turn line. */
export interface Feed {
  lines: FeedLine[]
  turn: Turn | null
}

export interface TranscriptSummary {
  contextTokens: number
  /** The model's context window as the transcript gives it (Codex); `null` — it does not, the agent is asked (`docs/sessions.md`). */
  contextWindow: number | null
  /** How many times the session's context was compacted: Claude's `compact_boundary`, Codex's `compacted` line. */
  compactions: number
  cache: CacheWindow | null
  tokens: TokenTotals
  turn: Turn | null
  action: FeedLine | null
  stage: Stage | null
  feed: FeedLine[]
  remoteUrl: string | null
  remoteLost: boolean
  apiError: { kind: ApiErrorKind; text: string; at: string; notice?: Notice } | null
  lastMessage: string | null
  checkpoint: string | null
  /** The path of the last response's `PULL REQUEST: <path>` line: PR mode's mark of a task done (BTN-205). */
  pullRequest: string | null
  /** The reason of the last response's `NO CHANGES: <why>` line: a task done with nothing to merge (EKR-10); `''` — none given. */
  noChanges: string | null
  /** An `AskUserQuestion` is waiting for the user's choice. */
  asking: boolean
  /** The `AskUserQuestion` waiting for the user's choice. */
  ask: Ask | null
  firstActivityAt: string | null
  lastActivityAt: string | null
  lastReplyAt: string | null
  gitBranch: string | null
  workdir: string | null
  /** The model of the last answer (Claude) or turn (Codex), as the agent names it; `null` — none yet. */
  model: string | null
}

const FEED_SIZE = 30
const TEXT_LIMIT = 500
const MESSAGE_LIMIT = 6000
const ERROR_LIMIT = 2000
const WRAP_UP_TEXT = 'Usage limit reached: Claude Code told the session to wrap up the turn'
const REMOTE_DROPPED = 'Remote Control disconnected'
const CHECKPOINT_LINE = /^[`*_]*CHECKPOINT:[`*_]*\s*[`*_]*([^`*\s][^`*]*?)[`*_]*$/
const PULL_REQUEST_LINE = /^[`*_]*PULL REQUEST:[`*_]*\s*[`*_]*([^`*\s][^`*]*?)[`*_]*$/
const NO_CHANGES_LINE = /^([`*_]*)NO CHANGES:([`*_]*)(.*)$/
const CONTEXT_BLOCK = /^<([a-z][\w-]*)\b[^>]*>[\s\S]*<\/\1>$/
const ASK_TOOL = 'AskUserQuestion'
const SHELLS =new Set(['Bash', 'PowerShell'])
export const TTL_MS:Record<CacheTtl, number> ={ '5m': 5 * 60_000, '1h': 60 * 60_000 }
const STAGE_RANK: Record<Stage, number> = { task: 0, recon: 1, edit: 2, test: 3, commit: 4, merge: 5 }

export class TranscriptFold {
  private readonly usageById = new Map<string, Usage>()
  private lastUsage: Usage | undefined
  private lastAnswerId: string | null = null
  private lastRequestAt: string | null = null
  private cacheTtl: CacheTtl | null = null
  private compactions = 0
  private feed: FeedLine[] = []
  private action: FeedLine | null = null
  private stage: Stage | null = null
  private remoteUrl: string | null = null
  private remoteLost = false
  private apiError: TranscriptSummary['apiError'] = null
  private wrapUp: TranscriptSummary['apiError'] = null
  private lastMessage: string | null = null
  private checkpoint: string | null = null
  private pullRequest: string | null = null
  private noChanges: string | null = null
  /** The `AskUserQuestion` call that has no result yet. */
  private openAsk: Ask | null = null
  /** An `AskUserQuestion` whose call ended without the user's answer: the next prompt answers it. */
  private strayAsk: Ask | null = null
  private firstActivityAt: string | null = null
  private lastActivityAt: string | null = null
  private lastReplyAt: string | null = null
  private gitBranch: string | null = null
  private workdir: string | null = null
  private model: string | null = null
  /** The file name of each `Read` call of a whole transcript, until its result comes. */
  private readonly readFiles = new Map<string, string>()
  private turnStartedAt: string | null = null
  private readonly mailSeen = new Set<number>()
  /** The tool lines of the turn's calls that have no result yet, by call id. */
  private readonly runningTools = new Map<string, string>()

  /** `whole` keeps texts and prompts as written and adds shell commands to tool lines. */
  constructor(
    private readonly feedSize = FEED_SIZE,
    private readonly whole = false,
  ) {}

  push(line: string): void {
    const entry = parseEntry(line)
    if (entry === undefined || entry.isSidechain === true) return
    if (typeof entry.gitBranch === 'string' && entry.gitBranch !== '') this.gitBranch = entry.gitBranch
    if (typeof entry.cwd === 'string' && entry.cwd !== '') this.workdir = entry.cwd

    if (entry.type === 'bridge-session' && typeof entry.bridgeSessionId === 'string') {
      this.remoteUrl = remoteUrlOf(entry.bridgeSessionId)
      return
    }
    if (entry.type === 'attachment' && entry.attachment?.type === 'remote_session_change' && typeof entry.attachment.url === 'string') {
      this.remoteUrl = entry.attachment.url
      this.remoteLost = false
      return
    }
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      this.compactions++
      return
    }
    if (entry.type === 'system' && typeof entry.content === 'string' && entry.content.startsWith(REMOTE_DROPPED)) {
      this.remoteLost = true
      return
    }
    if (entry.type === 'attachment' && entry.attachment?.type?.startsWith('hook_') === true) {
      this.pushMail(entry.timestamp ?? '', stringsOf(entry.attachment).join('\n'))
      return
    }
    if (entry.type === 'attachment' && entry.attachment?.type === 'queued_command') {
      this.pushQueued(entry.timestamp ?? '', entry.attachment)
      return
    }
    if (entry.type !== 'assistant' && entry.type !== 'user') return
    if (typeof entry.timestamp === 'string') {
      this.firstActivityAt ??= entry.timestamp
      this.lastActivityAt = entry.timestamp
    }
    if (entry.type === 'assistant') this.pushAssistant(entry)
    else this.pushUser(entry)
  }

  summary(): TranscriptSummary {
    const tokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    for (const usage of this.usageById.values()) {
      tokens.input += usage.input_tokens ?? 0
      tokens.output += usage.output_tokens ?? 0
      tokens.cacheRead += usage.cache_read_input_tokens ?? 0
      tokens.cacheWrite += usage.cache_creation_input_tokens ?? 0
    }
    const last = this.lastUsage
    const cache =
      this.cacheTtl === null || this.lastRequestAt === null
        ? null
        : { ttl: this.cacheTtl, until: new Date(Date.parse(this.lastRequestAt) + TTL_MS[this.cacheTtl]).toISOString() }
    return {
      contextTokens:
        (last?.input_tokens ?? 0) + (last?.cache_read_input_tokens ?? 0) + (last?.cache_creation_input_tokens ?? 0),
      contextWindow: null,
      compactions: this.compactions,
      cache,
      tokens,
      turn:
        this.turnStartedAt === null
          ? null
          : {
              startedAt: this.turnStartedAt,
              tool: [...this.runningTools.values()].pop() ?? null,
            },
      action: this.action,
      stage: this.stage,
      feed: [...this.feed],
      remoteUrl: this.remoteUrl,
      remoteLost: this.remoteLost,
      apiError: this.apiError ?? this.wrapUp,
      lastMessage: this.lastMessage,
      checkpoint: this.checkpoint,
      pullRequest: this.pullRequest,
      noChanges: this.noChanges,
      asking: this.openAsk !== null,
      ask: this.openAsk,
      firstActivityAt: this.firstActivityAt,
      lastActivityAt: this.lastActivityAt,
      lastReplyAt: this.lastReplyAt,
      gitBranch: this.gitBranch,
      workdir: this.workdir,
      model: this.model,
    }
  }

  private pushAssistant(entry: Entry): void {
    const at = entry.timestamp ?? ''
    const blocks = blocksOf(entry.message?.content)

    if (entry.isApiErrorMessage === true) {
      const text = flatten(blocks.map((block) => block.text ?? '').join(' '), TEXT_LIMIT) || String(entry.error)
      this.apiError = { kind: isSpendingLimit(text) ? 'spend' : API_ERROR_KINDS.get(entry.error) ?? (isTransientError(text) ? 'transient' : 'error'), text, at }
      this.addFeed({ at, kind: 'error', text })
      return
    }
    if (entry.message?.model === '<synthetic>') return

    if (typeof entry.message?.model === 'string' && entry.message.model !== '') this.model = entry.message.model
    this.apiError = null
    if (entry.timestamp !== undefined) this.lastReplyAt = entry.timestamp
    const usage = entry.message?.usage
    if (usage !== undefined) {
      this.lastUsage = usage
      this.cacheTtl = writtenTtl(usage) ?? this.cacheTtl
      const id = entry.message?.id
      if (typeof id === 'string') {
        this.usageById.set(id, usage)
        if (id !== this.lastAnswerId) {
          this.lastAnswerId = id
          this.lastRequestAt = entry.timestamp ?? null
        }
      }
    }

    for (const block of blocks) {
      if (block.type === 'text') {
        const text = this.textOf(block.text ?? '')
        if (text === '') continue
        this.addAction({ at, kind: 'text', text })
        this.lastMessage = (block.text ?? '').trim().slice(0, MESSAGE_LIMIT)
        this.checkpoint = checkpointOf(block.text ?? '')
        this.pullRequest = pullRequestOf(block.text ?? '')
        this.noChanges = noChangesOf(block.text ?? '')
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        this.checkpoint = null
        this.pullRequest = null
        this.noChanges = null
        const input = block.input ?? {}
        const line: FeedLine = { at, kind: 'tool', text: describeTool(block.name, input, entry.cwd) }
        if (this.whole && SHELLS.has(block.name) && typeof input.command === 'string') line.detail = input.command
        if (this.whole) Object.assign(line, callFacts(block.name, input, editSize(block.name, input)))
        if (this.whole && typeof block.id === 'string') {
          line.tool = block.id
          if (block.name === 'Read' && typeof input.file_path === 'string') this.readFiles.set(block.id, input.file_path.split(/[\\/]/).pop()!)
        }
        if (this.whole && block.name === SHARE_TOOL) line.share = shareOf(input, entry.cwd ?? '')
        // A call without a single question (input the CLI could not parse, BTN-304) is no question: an ordinary tool and its error.
        const questions = block.name === ASK_TOOL ? questionsOf(input) : []
        if (questions.length > 0) {
          this.openAsk = { id: block.id ?? ASK_TOOL, questions }
          this.strayAsk = null
          if (this.whole) line.ask = this.openAsk
        }
        if (typeof block.id === 'string') this.runningTools.set(block.id, line.text)
        this.addAction(line)
        this.advanceStage(stageOf(block.name, input))
      }
    }
  }

  private pushUser(entry: Entry): void {
    if (this.whole) this.pushImages(entry)
    for (const block of blocksOf(entry.message?.content)) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      this.runningTools.delete(block.tool_use_id)
      // A question's error result is how a stop or a resume delivers its answer (BTN-220): the answer line tells the rest.
      if (this.whole && block.is_error === true && block.tool_use_id !== this.openAsk?.id) {
        this.addFeed({ at: entry.timestamp ?? '', kind: 'failed', text: failureText(block.content), tool: block.tool_use_id })
      }
    }
    const ask = this.openAsk
    const askResult = ask === null ? undefined : blocksOf(entry.message?.content).find((block) => block.type === 'tool_result' && block.tool_use_id === ask.id)
    if (ask !== null && askResult !== undefined) {
      this.openAsk = null
      const answers = toolAnswers(entry.toolUseResult)
      // The mailbox hook turned the question down with the user's message: nothing is left to answer (BTN-181).
      const declined = askResult.is_error === true && this.pushMail(entry.timestamp ?? '', failureText(askResult.content, Infinity))
      if (answers !== null) this.addFeed({ at: entry.timestamp ?? '', kind: 'answer', text: '', answers: { ask: ask.id, answers } })
      else if (!declined) this.strayAsk = ask
    }
    if (isPrompt(entry.message?.content) && this.pushMail(entry.timestamp ?? '', promptOf(entry.message?.content))) return
    if (entry.usageLimitNote === 'wrap_up') {
      const at = entry.timestamp ?? ''
      this.wrapUp = { kind: 'limit', text: WRAP_UP_TEXT, at }
      this.addFeed({ at, kind: 'error', text: WRAP_UP_TEXT })
    } else if (entry.isMeta !== true && isPrompt(entry.message?.content)) {
      this.wrapUp = null
      this.checkpoint = null
      this.pullRequest = null
      this.noChanges = null
      this.turnStartedAt = entry.timestamp ?? ''
      this.runningTools.clear()
      if (entry.origin?.kind !== undefined && entry.origin.kind !== 'human') return
      const answered = this.openAsk ?? this.strayAsk
      this.openAsk = null
      this.strayAsk = null
      const line = userLine(entry.timestamp ?? '', promptOf(entry.message?.content), answered, (text) => this.textOf(text))
      if (line !== null) this.addFeed(line)
    }
  }

  // A line of its own after the tool line, not a mark on it: the page reads lines only once, and the result comes later.
  private pushImages(entry: Entry): void {
    for (const block of blocksOf(entry.message?.content)) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      const images = imagesOf(block.content).length
      if (images === 0) continue
      const text = this.readFiles.get(block.tool_use_id) ?? ''
      this.readFiles.delete(block.tool_use_id)
      this.addFeed({ at: entry.timestamp ?? '', kind: 'image', text, tool: block.tool_use_id, images })
    }
  }

  /**
   * The chat's messages a hook of the mailbox gave the session, as the user's prompts, each id once; whether `text`
   * held any. Read only where a hook's text lands, never from a tool's output: a Read of the source holds the mark too.
   */
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

  /** A message from Remote Control or the terminal that came mid-turn: no `user` line, only this attachment. */
  private pushQueued(at: string, attachment: NonNullable<Entry['attachment']>): void {
    const kind = attachment.origin?.kind
    if (kind !== undefined && kind !== 'human') return
    const prompt = promptOf(attachment.prompt)
    if (this.pushMail(at, prompt)) return
    const line = userLine(at, prompt, null, (text) => this.textOf(text))
    if (line !== null) this.addFeed(line)
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
    if (this.stage === null || STAGE_RANK[next] >= STAGE_RANK.edit || STAGE_RANK[next] > STAGE_RANK[this.stage]) {
      this.stage = next
    }
  }
}

/**
 * The feed line of a prompt: an answer when it answers `answered` or carries the answers of a lost question, else a
 * prompt; `null` for a prompt with nothing of the user's in it.
 */
export function userLine(at: string, prompt: string, answered: Ask | null, textOf: (text: string) => string): FeedLine | null {
  if (prompt.trim() === '') return null
  const reply = replyParts(prompt, answered)
  const text = textOf(reply.text)
  const files = reply.files.length > 0 ? { files: reply.files } : {}
  if (answered !== null) return { at, kind: 'answer', text, answers: { ask: answered.id, answers: reply.answers }, ...files }
  if (Object.keys(reply.answers).length > 0) return { at, kind: 'answer', text, answers: { answers: reply.answers }, ...files }
  if (text === '' && reply.files.length === 0) return null
  return { at, kind: 'prompt', text, ...files }
}

/** The name, the subject and the size of an edit of a call, for a tool line of a whole transcript. */
export function callFacts(name: string, input: Record<string, unknown>, size: EditSize | undefined): Partial<FeedLine> {
  const subject = subjectOf(name, input)
  return { name, ...(subject === undefined ? {} : { subject }), ...size }
}

/** The start of a failed call's output; the rest stays in the transcript. */
export function failureText(content: unknown, limit = ERROR_LIMIT): string {
  const text = typeof content === 'string' ? content : blocksOf(content).map((block) => block.text ?? '').join('\n')
  const trimmed = text.trim()
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed
}

/** Every string inside a value, depth first: where a hook's text sits in an attachment differs between versions. */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsOf)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringsOf)
  return []
}

function writtenTtl(usage: Usage): CacheTtl | null {
  const written = usage.cache_creation
  if ((written?.ephemeral_5m_input_tokens ?? 0) > 0) return '5m'
  if ((written?.ephemeral_1h_input_tokens ?? 0) > 0) return '1h'
  return null
}

export function checkpointOf(text: string): string | null {
  return lastLineMark(text, CHECKPOINT_LINE)
}

/** The path a response's last line `PULL REQUEST: <path>` names. */
export function pullRequestOf(text: string): string | null {
  return lastLineMark(text, PULL_REQUEST_LINE)
}

/** The reason a response's last line `NO CHANGES: <why>` gives, without the markdown wrapped around the line. */
export function noChangesOf(text: string): string | null {
  const found = NO_CHANGES_LINE.exec(lastLine(text))
  if (found === null) return null
  const [, open = '', close = '', rest = ''] = found
  const reason = rest.trim()
  return open !== '' && close === '' && reason.endsWith(open) ? reason.slice(0, -open.length).trim() : reason
}

function lastLineMark(text: string, mark: RegExp): string | null {
  return mark.exec(lastLine(text))?.[1] ?? null
}

function lastLine(text: string): string {
  return (text.trimEnd().split('\n').pop() ?? '').trim()
}

export function isPrompt(content: unknown): boolean {
  if (typeof content === 'string') return content.trim() !== ''
  if (!Array.isArray(content)) return false
  const blocks = content as ContentBlock[]
  return blocks.some((block) => block.type === 'text') && !blocks.some((block) => block.type === 'tool_result')
}

/** The prompt without the context blocks clients wrap around it (IDE selection, browser instructions); pasted text stays. */
export function promptOf(content: unknown): string {
  if (typeof content === 'string') return content
  return blocksOf(content)
    .filter((block) => block.type === 'text' && !isContextBlock(block.text ?? ''))
    .map((block) => (block.text ?? '').trim())
    .join('\n\n')
}

export function isContextBlock(text: string): boolean {
  const tag = CONTEXT_BLOCK.exec(text.trim())?.[1]
  return tag !== undefined && tag !== 'pasted_content'
}

function stageOf(name: string, input: Record<string, unknown>): Stage | undefined {
  if (/^mcp__.+__get_issue$/.test(name) || (name === 'Skill' && input.skill === 'huly-tracker')) return 'task'
  if (name === 'Read' || name === 'Grep' || name === 'Glob') return 'recon'
  if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit' || name === 'MultiEdit') return 'edit'
  if (name === 'Agent') return input.subagent_type === 'runner' ? 'test' : 'recon'
  if ((name === 'Bash' || name === 'PowerShell') && typeof input.command === 'string') return stageOfCommand(input.command)
  return undefined
}

export function stageOfCommand(command: string): Stage | undefined {
  if (/\bgit\b[^|;&\n]*\bmerge\b/.test(command)) return 'merge'
  if (/\bgit\b[^|;&\n]*\bcommit\b/.test(command)) return 'commit'
  if (/\b(vitest|jest|pytest|playwright\s+test|(npm|pnpm|yarn)\s+(run\s+)?test|dotnet\s+test|go\s+test|cargo\s+test)\b/.test(command)) {
    return 'test'
  }
  return undefined
}
