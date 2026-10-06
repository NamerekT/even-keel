import type { ReceivedMcp, ReceivedTools, SkillSource } from './model.js'

type Json = Record<string, unknown>

const MCP_TOOL = /^mcp__(.+?)__/
const CLAUDE_AI_PREFIX = 'anthropic-skills:'

export interface KnownSkills {
  user: Set<string>
  project: Set<string>
}

/** Folds the first lines of a transcript into what the session got; `undefined` when they hold no tool attachment. */
export function readReceived(lines: string[]): ReceivedTools | undefined {
  let sessionId: string | null = null
  let cwd: string | null = null
  let at: string | null = null
  let version: string | null = null
  let mode: string | null = null
  let seen = false
  let listingChars = 0
  const skills = new Set<string>()
  const tools = new Set<string>()
  const failed = new Set<string>()

  for (const text of lines) {
    const entry = parse(text)
    if (entry === undefined) continue
    if (sessionId === null && typeof entry.sessionId === 'string') sessionId = entry.sessionId
    if (entry.type === 'user' && cwd === null && typeof entry.cwd === 'string') {
      cwd = entry.cwd
      at = stringOrNull(entry.timestamp)
      version = stringOrNull(entry.version)
      mode = stringOrNull(entry.permissionMode)
    }
    if (entry.type !== 'attachment') continue
    const attachment = objectOf(entry.attachment)
    if (attachment.type === 'skill_listing') {
      seen = true
      for (const name of strings(attachment.names)) skills.add(name)
      if (typeof attachment.content === 'string') listingChars += attachment.content.length
    } else if (attachment.type === 'prompt_snapshot' && Array.isArray(attachment.tools)) {
      seen = true
      for (const tool of attachment.tools) {
        const name = objectOf(tool).name
        if (typeof name === 'string') tools.add(name)
      }
    } else if (attachment.type === 'deferred_tools_delta') {
      seen = true
      for (const name of strings(attachment.addedNames)) tools.add(name)
      for (const name of strings(attachment.removedNames)) tools.delete(name)
      for (const name of strings(attachment.failedMcpServers)) failed.add(name)
    }
  }
  if (!seen) return undefined

  const servers = new Map<string, number>()
  for (const name of tools) {
    const server = MCP_TOOL.exec(name)?.[1]
    if (server !== undefined) servers.set(server, (servers.get(server) ?? 0) + 1)
  }
  for (const name of failed) if (!servers.has(name)) servers.set(name, 0)
  const mcp: ReceivedMcp[] = [...servers]
    .map(([name, count]) => ({ name, tools: count, failed: failed.has(name) && count === 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    sessionId,
    cwd,
    at,
    version,
    mode,
    skills: [...skills],
    listingChars,
    tools: [...tools].filter((name) => !MCP_TOOL.test(name)),
    mcp,
  }
}

export function skillSource(name: string, known: KnownSkills): SkillSource {
  if (name.startsWith(CLAUDE_AI_PREFIX)) return 'claudeai'
  if (name.includes(':')) return 'plugin'
  if (known.project.has(name)) return 'project'
  if (known.user.has(name)) return 'user'
  return 'bundled'
}

function parse(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
  } catch {
    return undefined
  }
}

function objectOf(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : []
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
