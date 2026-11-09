import type { BadgeAction } from './model.js'

const LIMIT = 60
const FILE_TOOLS: Record<string, string> = { Read: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' }
/** The tools whose own words describe the call; a shell command without a description shows only the tool. */
const DESCRIBED: Record<string, string> = { Bash: 'description', PowerShell: 'description', Agent: 'description', Task: 'description', Skill: 'skill' }

/**
 * What the README badge says of a tool call (BTN-915): the tool and, where it is safe to publish, its short description —
 * a file path inside the repository, a command's own description, a skill. A path outside the repository, a bare command,
 * a pattern, a query or an MCP call show only the tool: nothing private leaves the machine.
 */
export function badgeActionOf(name: string, input: Record<string, unknown>, cwd: string | undefined): BadgeAction {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  const tool = mcp ? mcp[2]! : name
  const brief = mcp ? null : briefOf(name, input, cwd)
  const text = brief === null ? tool : `${tool} ${brief}`
  return { tool, text: text.length > LIMIT ? `${text.slice(0, LIMIT - 1).trimEnd()}…` : text }
}

function briefOf(name: string, input: Record<string, unknown>, cwd: string | undefined): string | null {
  const fileKey = FILE_TOOLS[name]
  if (fileKey !== undefined) return typeof input[fileKey] === 'string' ? insideRepo(input[fileKey], cwd) : null
  const key = DESCRIBED[name]
  const value = key === undefined ? undefined : input[key]
  if (typeof value !== 'string') return null
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat === '' ? null : flat
}

/** The path relative to the repository, `null` for one outside it. */
export function insideRepo(file: string, cwd: string | undefined): string | null {
  const path = file.replace(/\\/g, '/')
  const absolute = /^([a-zA-Z]:)?\//.test(path)
  if (!absolute) return path.split('/').includes('..') || path === '' ? null : path.replace(/^\.\//, '')
  if (cwd === undefined) return null
  const root = `${cwd.replace(/\\/g, '/').replace(/\/$/, '')}/`
  if (!path.toLowerCase().startsWith(root.toLowerCase())) return null
  const rest = path.slice(root.length)
  return rest === '' || rest.split('/').includes('..') ? null : rest
}
