import { blocksOf, describeTool, flatten, parseEntry, type ContentBlock, type Entry, type Usage } from './entry.js'
import { remoteUrlOf } from './remote.js'

export type Stage = 'task' | 'recon' | 'edit' | 'test' | 'commit' | 'merge'
export type ApiErrorKind = 'limit' | 'error'

export interface FeedLine {
  at: string
  kind: 'text' | 'tool' | 'error' | 'prompt'
  text: string
  /** The whole shell command of a tool line, only in a whole transcript. */
  detail?: string
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

export interface TranscriptSummary {
  contextTokens: number
  cache: CacheWindow | null
  tokens: TokenTotals
  action: FeedLine | null
  stage: Stage | null
  feed: FeedLine[]
  remoteUrl: string | null
  remoteLost: boolean
  apiError: { kind: ApiErrorKind; text: string; at: string } | null
  lastMessage: string | null
  checkpoint: string | null
  /** An `AskUserQuestion` is waiting for the user's choice. */
  asking: boolean
  firstActivityAt: string | null
  lastActivityAt: string | null
  lastReplyAt: string | null
  gitBranch: string | null
  workdir: string | null
}

const FEED_SIZE = 30
const TEXT_LIMIT = 500
const MESSAGE_LIMIT = 6000
const WRAP_UP_TEXT = 'Usage limit reached: Claude Code told the session to wrap up the turn'
const REMOTE_DROPPED = 'Remote Control disconnected'
const CHECKPOINT_LINE = /^[`*_]*CHECKPOINT:[`*_]*\s*[`*_]*([^`*\s][^`*]*?)[`*_]*$/
const CONTEXT_BLOCK = /^<([a-z][\w-]*)\b[^>]*>[\s\S]*<\/\1>$/
const ASK_TOOL = 'AskUserQuestion'
const SHELLS =new Set(['Bash', 'PowerShell'])
const TTL_MS:Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }
const STAGE_RANK: Record<Stage, number> = { task: 0, recon: 1, edit: 2, test: 3, commit: 4, merge: 5 }

export class TranscriptFold {
  private readonly usageById = new Map<string, Usage>()
  private lastUsage: Usage | undefined
  private lastAnswerId: string | null = null
  private lastRequestAt: string | null = null
  private cacheTtl: CacheTtl | null = null
  private feed: FeedLine[] = []
  private action: FeedLine | null = null
  private stage: Stage | null = null
  private remoteUrl: string | null = null
  private remoteLost = false
  private apiError: TranscriptSummary['apiError'] = null
  private wrapUp: TranscriptSummary['apiError'] = null
  private lastMessage: string | null = null
  private checkpoint: string | null = null
  /** The id of an `AskUserQuestion` call that has no result yet. */
  private openAsk: string | null = null
  private firstActivityAt: string | null = null
  private lastActivityAt: string | null = null
  private lastReplyAt: string | null = null
  private gitBranch: string | null = null
  private workdir: string | null = null

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
    if (entry.type === 'system' && typeof entry.content === 'string' && entry.content.startsWith(REMOTE_DROPPED)) {
      this.remoteLost = true
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
      cache,
      tokens,
      action: this.action,
      stage: this.stage,
      feed: [...this.feed],
      remoteUrl: this.remoteUrl,
      remoteLost: this.remoteLost,
      apiError: this.apiError ?? this.wrapUp,
      lastMessage: this.lastMessage,
      checkpoint: this.checkpoint,
      asking: this.openAsk !== null,
      firstActivityAt: this.firstActivityAt,
      lastActivityAt: this.lastActivityAt,
      lastReplyAt: this.lastReplyAt,
      gitBranch: this.gitBranch,
      workdir: this.workdir,
    }
  }

  private pushAssistant(entry: Entry): void {
    const at = entry.timestamp ?? ''
    const blocks = blocksOf(entry.message?.content)

    if (entry.isApiErrorMessage === true) {
      const text = flatten(blocks.map((block) => block.text ?? '').join(' '), TEXT_LIMIT) || String(entry.error)
      this.apiError = { kind: entry.error === 'rate_limit' ? 'limit' : 'error', text, at }
      this.addFeed({ at, kind: 'error', text })
      return
    }
    if (entry.message?.model === '<synthetic>') return

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
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        this.checkpoint = null
        if (block.name === ASK_TOOL) this.openAsk = block.id ?? ASK_TOOL
        const input = block.input ?? {}
        const line: FeedLine = { at, kind: 'tool', text: describeTool(block.name, input, entry.cwd) }
        if (this.whole && SHELLS.has(block.name) && typeof input.command === 'string') line.detail = input.command
        this.addAction(line)
        this.advanceStage(stageOf(block.name, input))
      }
    }
  }

  private pushUser(entry: Entry): void {
    if (this.openAsk !== null && blocksOf(entry.message?.content).some((block) => block.type === 'tool_result' && block.tool_use_id === this.openAsk)) {
      this.openAsk = null
    }
    if (entry.usageLimitNote === 'wrap_up') {
      const at = entry.timestamp ?? ''
      this.wrapUp = { kind: 'limit', text: WRAP_UP_TEXT, at }
      this.addFeed({ at, kind: 'error', text: WRAP_UP_TEXT })
    } else if (entry.isMeta !== true && isPrompt(entry.message?.content)) {
      this.wrapUp = null
      this.checkpoint = null
      if (entry.origin?.kind !== undefined && entry.origin.kind !== 'human') return
      const text = this.textOf(promptOf(entry.message?.content))
      if (text !== '') this.addFeed({ at: entry.timestamp ?? '', kind: 'prompt', text })
    }
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

function writtenTtl(usage: Usage): CacheTtl | null {
  const written = usage.cache_creation
  if ((written?.ephemeral_5m_input_tokens ?? 0) > 0) return '5m'
  if ((written?.ephemeral_1h_input_tokens ?? 0) > 0) return '1h'
  return null
}

function checkpointOf(text: string): string | null {
  const last = text.trimEnd().split('\n').pop() ?? ''
  return CHECKPOINT_LINE.exec(last.trim())?.[1] ?? null
}

function isPrompt(content: unknown): boolean {
  if (typeof content === 'string') return content.trim() !== ''
  if (!Array.isArray(content)) return false
  const blocks = content as ContentBlock[]
  return blocks.some((block) => block.type === 'text') && !blocks.some((block) => block.type === 'tool_result')
}

/** The prompt without the context blocks clients wrap around it (IDE selection, browser instructions); pasted text stays. */
function promptOf(content: unknown): string {
  if (typeof content === 'string') return content
  return blocksOf(content)
    .filter((block) => block.type === 'text' && !isContextBlock(block.text ?? ''))
    .map((block) => (block.text ?? '').trim())
    .join('\n\n')
}

function isContextBlock(text: string): boolean {
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

function stageOfCommand(command: string): Stage | undefined {
  if (/\bgit\b[^|;&\n]*\bmerge\b/.test(command)) return 'merge'
  if (/\bgit\b[^|;&\n]*\bcommit\b/.test(command)) return 'commit'
  if (/\b(vitest|jest|pytest|playwright\s+test|(npm|pnpm|yarn)\s+(run\s+)?test|dotnet\s+test|go\s+test|cargo\s+test)\b/.test(command)) {
    return 'test'
  }
  return undefined
}
