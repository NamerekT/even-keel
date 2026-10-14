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
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
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
  attachment?: { type?: string; url?: unknown }
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

function relativePath(file: string, cwd: string | undefined): string {
  const path = file.replace(/\\/g, '/')
  if (cwd === undefined) return path
  const root = `${cwd.replace(/\\/g, '/').replace(/\/$/, '')}/`
  return path.toLowerCase().startsWith(root.toLowerCase()) ? path.slice(root.length) : path
}
