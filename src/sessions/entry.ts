export interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  speed?: string
}

export interface ContentBlock {
  type?: string
  text?: string
  /** Empty for hidden thinking; with `display: "updates"` the narration the user is shown sits here. */
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
  /** The picture of an `image` block: the CLI keeps it whole in the transcript, base64. */
  source?: { type?: string; media_type?: string; data?: string }
}

export interface TranscriptImage {
  type: string
  data: string
}

/** The base64 pictures of a tool result's content. */
export function imagesOf(content: unknown): TranscriptImage[] {
  return blocksOf(content).flatMap(({ type, source }) =>
    type === 'image' && source?.type === 'base64' && typeof source.data === 'string' && typeof source.media_type === 'string'
      ? [{ type: source.media_type, data: source.data }]
      : [],
  )
}

export interface Entry {
  type?: string
  subtype?: string
  uuid?: string
  sessionId?: string
  agentId?: string
  entrypoint?: string
  isSidechain?: boolean
  isMeta?: boolean
  isApiErrorMessage?: boolean
  error?: string
  usageLimitNote?: string
  timestamp?: string
  cwd?: string
  gitBranch?: string
  effort?: string
  bridgeSessionId?: string
  customTitle?: string
  aiTitle?: string
  content?: unknown
  /** `prompt` and `origin` — of a `queued_command`: a message the CLI took into a running turn. */
  attachment?: { type?: string; url?: unknown; prompt?: unknown; origin?: { kind?: string } }
  origin?: { kind?: string }
  toolUseResult?: unknown
  message?: { id?: string; model?: string; content?: unknown; usage?: Usage }
}

const BRIEF_LIMIT = 160
const BRIEF_KEYS = ['description', 'command', 'file_path', 'pattern', 'query', 'url', 'skill']
const MCP_BRIEF_KEYS = ['identifier', 'issueIdentifier', 'title', 'name', 'query']

export function parseEntry(line: string): Entry | undefined {
  if (line.trim() === '') return undefined
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Entry) : undefined
  } catch {
    return undefined
  }
}

export function blocksOf(content: unknown): ContentBlock[] {
  return Array.isArray(content) ? (content as ContentBlock[]) : []
}

export function flatten(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}

export function describeTool(name: string, input: Record<string, unknown>, cwd: string | undefined): string {
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

const SUBJECT_KEYS: Record<string, string> = {
  Read: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
  Bash: 'description',
  PowerShell: 'description',
  Grep: 'pattern',
  Glob: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
  Skill: 'skill',
}

/** What a call is about, for the page to show beside its verb: a file's path as given, a command's description, a pattern. */
export function subjectOf(name: string, input: Record<string, unknown>): string | undefined {
  const key = SUBJECT_KEYS[name]
  const value = key === undefined ? undefined : input[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export interface EditSize {
  added: number
  removed: number
}

/** The lines an edit adds and removes; `undefined` for a call that edits nothing. */
export function editSize(name: string, input: Record<string, unknown>): EditSize | undefined {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  if (name === 'Edit') return diffSize(text(input.old_string), text(input.new_string))
  if (name === 'Write') return { added: lineCount(text(input.content)), removed: 0 }
  if (name === 'NotebookEdit') return { added: input.edit_mode === 'delete' ? 0 : lineCount(text(input.new_source)), removed: 0 }
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    return (input.edits as Record<string, unknown>[]).reduce<EditSize>(
      (sum, edit) => {
        const size = diffSize(text(edit.old_string), text(edit.new_string))
        return { added: sum.added + size.added, removed: sum.removed + size.removed }
      },
      { added: 0, removed: 0 },
    )
  }
  return undefined
}

/** The lines of `after` and `before` left once their common first and last lines are put aside. */
export function diffSize(before: string, after: string): EditSize {
  const old = linesOf(before)
  const next = linesOf(after)
  let head = 0
  while (head < old.length && head < next.length && old[head] === next[head]) head += 1
  let tail = 0
  while (tail < old.length - head && tail < next.length - head && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1
  return { added: next.length - head - tail, removed: old.length - head - tail }
}

export function lineCount(text: string): number {
  return linesOf(text).length
}

function linesOf(text: string): string[] {
  return text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/)
}

function relativePath(file: string, cwd: string | undefined): string {
  const path = file.replace(/\\/g, '/')
  if (cwd === undefined) return path
  const root = `${cwd.replace(/\\/g, '/').replace(/\/$/, '')}/`
  return path.toLowerCase().startsWith(root.toLowerCase()) ? path.slice(root.length) : path
}
