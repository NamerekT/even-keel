import { remoteUrlOf } from './remote.js'

export type Stage = 'task' | 'recon' | 'edit' | 'test' | 'commit' | 'merge'
export type ApiErrorKind = 'limit' | 'error'

export interface FeedLine {
  at: string
  kind: 'text' | 'tool' | 'error'
  text: string
}

export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface TranscriptSummary {
  contextTokens: number
  tokens: TokenTotals
  action: FeedLine | null
  stage: Stage | null
  feed: FeedLine[]
  remoteUrl: string | null
  apiError: { kind: ApiErrorKind; text: string; at: string } | null
  firstActivityAt: string | null
  lastActivityAt: string | null
  lastReplyAt: string | null
  gitBranch: string | null
  workdir: string | null
}

interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface ContentBlock {
  type?: string
  text?: string
  name?: string
  input?: Record<string, unknown>
}

interface Entry {
  type?: string
  isSidechain?: boolean
  isApiErrorMessage?: boolean
  error?: string
  timestamp?: string
  cwd?: string
  gitBranch?: string
  bridgeSessionId?: string
  message?: { id?: string; model?: string; content?: unknown; usage?: Usage }
}

const FEED_SIZE = 30
const TEXT_LIMIT = 500
const BRIEF_LIMIT = 160
const STAGE_RANK: Record<Stage, number> = { task: 0, recon: 1, edit: 2, test: 3, commit: 4, merge: 5 }
const BRIEF_KEYS = ['description', 'command', 'file_path', 'pattern', 'query', 'url', 'skill']
const MCP_BRIEF_KEYS = ['identifier', 'issueIdentifier', 'title', 'name', 'query']

export class TranscriptFold {
  private readonly usageById = new Map<string, Usage>()
  private lastUsage: Usage | undefined
  private feed: FeedLine[] = []
  private action: FeedLine | null = null
  private stage: Stage | null = null
  private remoteUrl: string | null = null
  private apiError: TranscriptSummary['apiError'] = null
  private firstActivityAt: string | null = null
  private lastActivityAt: string | null = null
  private lastReplyAt: string | null = null
  private gitBranch: string | null = null
  private workdir: string | null = null

  constructor(private readonly feedSize = FEED_SIZE) {}

  push(line: string): void {
    const entry = parse(line)
    if (entry === undefined || entry.isSidechain === true) return
    if (typeof entry.gitBranch === 'string' && entry.gitBranch !== '') this.gitBranch = entry.gitBranch
    if (typeof entry.cwd === 'string' && entry.cwd !== '') this.workdir = entry.cwd

    if (entry.type === 'bridge-session' && typeof entry.bridgeSessionId === 'string') {
      this.remoteUrl = remoteUrlOf(entry.bridgeSessionId)
      return
    }
    if (entry.type !== 'assistant' && entry.type !== 'user') return
    if (typeof entry.timestamp === 'string') {
      this.firstActivityAt ??= entry.timestamp
      this.lastActivityAt = entry.timestamp
    }
    if (entry.type === 'assistant') this.pushAssistant(entry)
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
    return {
      contextTokens:
        (last?.input_tokens ?? 0) + (last?.cache_read_input_tokens ?? 0) + (last?.cache_creation_input_tokens ?? 0),
      tokens,
      action: this.action,
      stage: this.stage,
      feed: [...this.feed],
      remoteUrl: this.remoteUrl,
      apiError: this.apiError,
      firstActivityAt: this.firstActivityAt,
      lastActivityAt: this.lastActivityAt,
      lastReplyAt: this.lastReplyAt,
      gitBranch: this.gitBranch,
      workdir: this.workdir,
    }
  }

  private pushAssistant(entry: Entry): void {
    const at = entry.timestamp ?? ''
    const blocks = Array.isArray(entry.message?.content) ? (entry.message.content as ContentBlock[]) : []

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
      if (typeof entry.message?.id === 'string') this.usageById.set(entry.message.id, usage)
    }

    for (const block of blocks) {
      if (block.type === 'text') {
        const text = flatten(block.text ?? '', TEXT_LIMIT)
        if (text !== '') this.addAction({ at, kind: 'text', text })
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        const input = block.input ?? {}
        this.addAction({ at, kind: 'tool', text: describeTool(block.name, input, entry.cwd) })
        this.advanceStage(stageOf(block.name, input))
      }
    }
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

function parse(line: string): Entry | undefined {
  if (line.trim() === '') return undefined
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null ? (value as Entry) : undefined
  } catch {
    return undefined
  }
}

function flatten(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}

function describeTool(name: string, input: Record<string, unknown>, cwd: string | undefined): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  const label = mcp ? `${mcp[1]} ${mcp[2]}` : name
  const key = (mcp ? MCP_BRIEF_KEYS : BRIEF_KEYS).find((candidate) => typeof input[candidate] === 'string' && input[candidate] !== '')
  const value = key === undefined ? Object.values(input).find((candidate) => typeof candidate === 'string') : input[key]
  if (typeof value !== 'string') return label
  let brief = value
  if (key === 'file_path') brief = relativePath(brief, cwd)
  if (key === 'command') brief = brief.split('\n', 1)[0] ?? ''
  const short = flatten(brief, BRIEF_LIMIT)
  return short === '' ? label : `${label} ${short}`
}

function relativePath(file: string, cwd: string | undefined): string {
  const path = file.replace(/\\/g, '/')
  if (cwd === undefined) return path
  const root = `${cwd.replace(/\\/g, '/').replace(/\/$/, '')}/`
  return path.toLowerCase().startsWith(root.toLowerCase()) ? path.slice(root.length) : path
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
