import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { repoTail } from '../../src/stats/model.js'

export type RuleKind = 'claude_md' | 'skill' | 'memory' | 'hook' | 'settings' | 'agent'

export interface RuleFile {
  key: string
  display: string
  kind: RuleKind
  scope: string
}

export const GLOBAL_SCOPE = 'global'

const SKILL_BASE = /^Base directory for this skill: ([^\n]+)\n\n([\s\S]*)$/
const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/
const WORKTREE = /\/\.claude\/worktrees\/[^/]+(?=\/|$)/i
const MEMORY = /^projects\/([^/]+)\/memory\/[^/]+\.md$/i
// A skill is a folder: skills/<name> itself is no file, only what lies in it.
const UNDER = /^(?:(skills)\/[^/]+|(hooks|agents))\/./i
// Skills synced by the desktop app and its trash are not the user's own.
const FOREIGN_SKILLS = /^skills\/(synced|\.[^/]*)\//i
const PROJECT_RULE = /^(.*)\/\.claude\/(skills\/[^/]+\/.+|agents\/.+|settings(?:\.local)?\.json)$/i
const SKIPPED_PART = /(^|\/)(node_modules|\.git)\//i
// Logs, package manifests and backups next to the hook scripts are not rules.
const HOOK_NOISE = /(?:\.log|\.bak|\.bak-[^/]*|\.tmp|(?:^|\/)package(?:-lock)?\.json)$/i

const normal = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '')

export function ruleFileOf(path: string, home: string): RuleFile | null {
  const file = normal(path)
  const base = normal(home)
  const lower = file.toLowerCase()
  const lowerBase = base.toLowerCase()
  if (lower === `${lowerBase}/.claude.json`) return { key: '~/.claude.json', display: '~/.claude.json', kind: 'settings', scope: GLOBAL_SCOPE }
  if (lower.startsWith(`${lowerBase}/.githooks/`)) {
    const rest = file.slice(base.length + '/.githooks/'.length)
    if (SKIPPED_PART.test(rest) || HOOK_NOISE.test(rest)) return null
    const display = `~/.githooks/${rest}`
    return { key: display.toLowerCase(), display, kind: 'hook', scope: GLOBAL_SCOPE }
  }
  if (lower.startsWith(`${lowerBase}/.claude/`)) return configRule(file.slice(base.length + '/.claude/'.length), null)
  if (lower.startsWith(`${lowerBase}/.claude-accounts/`)) {
    const rest = file.slice(base.length + '/.claude-accounts/'.length)
    const slash = rest.indexOf('/')
    return slash <= 0 ? null : configRule(rest.slice(slash + 1), rest.slice(0, slash))
  }
  // The stores behind the links of ~/.claude (src/account/share.ts) take the keys their linked paths have.
  for (const name of ['skills', 'hooks', 'agents']) {
    const store = `/.claude-${name}/`
    if (lower.startsWith(`${lowerBase}${store}`)) return configRule(`${name}/${file.slice(base.length + store.length)}`, null)
  }
  if (lower.startsWith(`${lowerBase}/.claude-memory/`)) {
    const rest = file.slice(base.length + '/.claude-memory/'.length)
    const slash = rest.indexOf('/')
    return slash <= 0 ? null : configRule(`projects/${rest.slice(0, slash)}/memory/${rest.slice(slash + 1)}`, null)
  }
  return projectRule(file.replace(WORKTREE, ''))
}

function configRule(rest: string, account: string | null): RuleFile | null {
  const make = (kind: RuleKind, scope = GLOBAL_SCOPE): RuleFile => {
    const display = `~/.claude/${rest}`
    return { key: display.toLowerCase(), display, kind, scope }
  }
  const lower = rest.toLowerCase()
  if (lower === 'claude.md') return make('claude_md')
  if (lower === 'settings.json' || lower === '.claude.json') {
    const display = account === null ? `~/.claude/${rest}` : `~/.claude-accounts/${account}/${rest}`
    return { key: display.toLowerCase(), display, kind: 'settings', scope: GLOBAL_SCOPE }
  }
  const under = UNDER.exec(rest)
  if (under !== null && !FOREIGN_SKILLS.test(rest)) return make(({ skills: 'skill', hooks: 'hook', agents: 'agent' } as const)[(under[1] ?? under[2])!.toLowerCase() as 'skills'])
  const memory = MEMORY.exec(rest)
  if (memory !== null) return make('memory', `slug:${memory[1]!.toLowerCase()}`)
  return null
}

function projectRule(file: string): RuleFile | null {
  const name = file.split('/').at(-1)!
  if (name.toLowerCase() === 'claude.md') {
    return { key: repoTail(file), display: file, kind: 'claude_md', scope: repoTail(file.slice(0, -name.length - 1)) }
  }
  const match = PROJECT_RULE.exec(file)
  if (match === null) return null
  const what = match[2]!.toLowerCase()
  const kind: RuleKind = what.startsWith('skills/') ? 'skill' : what.startsWith('agents/') ? 'agent' : 'settings'
  return { key: repoTail(file), display: file, kind, scope: repoTail(match[1]!) }
}

// Shell writes, moves and removals, plus PowerShell copies and redirects into a CLAUDE.md.
const WRITES =
  /(\brm\b|Remove-Item|\bmv\b|Move-Item|\bcp\b|Copy-Item|>\s*\S*(?:\.claude|CLAUDE\.md)|\btee\b|sed -i|perl -i|Set-Content|Add-Content|Out-File|open\([^)]*['"]w|\.write|writeFileSync)/i
const TOKEN_SPLIT = /[\s'"`;|&()<>,=]+/
const HOME_PREFIX = /^(?:~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%)(?=[\\/])/i
const MSYS_DRIVE = /^\/([a-z])\//i
const RULE_TOKEN = /\.claude|\.githooks|claude\.md$/i

const CD = /^\s*(?:cd|chdir|sl|set-location|pushd)(?=\s|$)(.*)$/is
const HEREDOC = /<<-?\s*['"]?(\w+)['"]?/
const SEGMENT_SPLIT = /&&|\|\||;|\|/

// Command lines with each heredoc body kept on the line that opens it.
function commandLines(command: string): string[] {
  const lines = command.split(/\r?\n/)
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const delimiter = HEREDOC.exec(lines[i]!)?.[1]
    if (delimiter === undefined) {
      out.push(lines[i]!)
      continue
    }
    let end = i + 1
    while (end < lines.length && lines[end]!.trim() !== delimiter) end++
    out.push(lines.slice(i, end + 1).join('\n'))
    i = end
  }
  return out
}

// A path as the shell would resolve it from `cwd`; null when it cannot be told (unknown folder, variables).
function resolvePath(raw: string, cwd: string | null, home: string): string | null {
  const path = raw.replace(HOME_PREFIX, normal(home)).replace(MSYS_DRIVE, (_, drive: string) => `${drive.toUpperCase()}:/`)
  if (path.includes('$') || path.includes('%')) return null
  if (/^[a-z]:[\\/]/i.test(path)) return posix.normalize(normal(path))
  return cwd === null ? null : posix.normalize(`${normal(cwd)}/${normal(path)}`)
}

function cdTarget(args: string, cwd: string | null, home: string): string | null {
  const word = args.trim().split(/\s+/).find((each) => each !== '' && !/^(?:-[a-z]{2,}|\/d)$/i.test(each))
  const target = word?.replace(/^['"]|['"]$/g, '')
  if (target === undefined || target === '~') return normal(home)
  if (target === '-') return null
  return resolvePath(target, cwd, home)
}

// Rule files a shell command writes, judged by its text: a write marker in a command segment (between &&, ||, ;, |, a new
// line) and the file's path among that segment's words, resolved from the folder the cd's before it moved to.
export function shellRuleFiles(command: string, cwd: string | null, home: string): RuleFile[] {
  if (!WRITES.test(command)) return []
  const files = new Map<string, RuleFile>()
  let dir = cwd
  for (const line of commandLines(command)) {
    const body = line.indexOf('\n')
    const head = body < 0 ? line : line.slice(0, body)
    const rest = body < 0 ? '' : line.slice(body)
    const parts = head.split(SEGMENT_SPLIT)
    parts[parts.length - 1] += rest
    for (const segment of parts) {
      const move = CD.exec(segment)
      if (move !== null) {
        dir = cdTarget(move[1]!, dir, home)
        continue
      }
      if (!WRITES.test(segment)) continue
      for (const token of segment.split(TOKEN_SPLIT)) {
        if (!RULE_TOKEN.test(token) || /[*?{}]/.test(token)) continue
        const path = resolvePath(token, dir, home)
        const file = path === null ? null : ruleFileOf(path, home)
        if (file !== null) files.set(file.key, file)
      }
    }
  }
  return [...files.values()]
}

const SECRET_KEYS = new Set(['env', 'headers'])

// The rules part of .claude.json: MCP servers, and per project its MCP servers and allowed tools. Values of env and
// headers are secrets and are replaced. The rest are counters and caches that change every session.
export function claudeJsonRules(text: string): string | null {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
  const rules: Record<string, unknown> = {}
  if (isFilled(data.mcpServers)) rules.mcpServers = data.mcpServers
  const projects: Record<string, unknown> = {}
  for (const [path, project] of Object.entries((data.projects ?? {}) as Record<string, Record<string, unknown>>)) {
    const kept: Record<string, unknown> = {}
    for (const name of ['mcpServers', 'allowedTools']) if (isFilled(project?.[name])) kept[name] = project[name]
    if (Object.keys(kept).length > 0) projects[path] = kept
  }
  if (Object.keys(projects).length > 0) rules.projects = projects
  return JSON.stringify(sorted(rules, false), null, 2)
}

const isFilled = (value: unknown) =>
  value !== null && typeof value === 'object' && (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0)

function sorted(value: unknown, secret: boolean): unknown {
  if (Array.isArray(value)) return value.map((each) => sorted(each, secret))
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return Object.fromEntries(entries.map(([key, inner]) => [key, secret ? '***' : sorted(inner, SECRET_KEYS.has(key))]))
  }
  return value
}

export function canon(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

export function hashOf(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

export function lineCount(text: string): number {
  return text === '' ? 0 : text.split('\n').length
}

export function stripFrontmatter(text: string): string {
  return canon(canon(text).replace(FRONTMATTER, ''))
}

export function isSkillFile(file: RuleFile): boolean {
  return file.kind === 'skill' && file.key.endsWith('/skill.md')
}

export function skillBody(text: string): { dir: string; body: string } | null {
  const match = SKILL_BASE.exec(text.replace(/\r\n/g, '\n'))
  return match === null ? null : { dir: match[1]!.trim(), body: canon(match[2]!) }
}

export function skillDescriptions(content: string, names: string[]): Map<string, string> {
  const text = `\n${content.replace(/\r\n/g, '\n')}`
  const starts = names
    .map((name) => ({ name, at: text.indexOf(`\n- ${name}: `) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at)
  const result = new Map<string, string>()
  starts.forEach(({ name, at }, index) => {
    const end = starts[index + 1]?.at ?? text.length
    result.set(name, canon(text.slice(at + `\n- ${name}: `.length, end)))
  })
  return result
}
