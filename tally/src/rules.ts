import { createHash } from 'node:crypto'
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
const UNDER = /^(skills|hooks|agents)\/./i
// Skills synced by the desktop app and its trash are not the user's own.
const FOREIGN_SKILLS = /^skills\/(synced|\.[^/]*)\//i
const PROJECT_RULE = /^(.*)\/\.claude\/(skills\/.+|agents\/.+|settings\.json)$/i

const normal = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '')

export function ruleFileOf(path: string, home: string): RuleFile | null {
  const file = normal(path)
  const base = normal(home)
  const lower = file.toLowerCase()
  const lowerBase = base.toLowerCase()
  if (lower.startsWith(`${lowerBase}/.claude/`)) return configRule(file.slice(base.length + '/.claude/'.length), null)
  if (lower.startsWith(`${lowerBase}/.claude-accounts/`)) {
    const rest = file.slice(base.length + '/.claude-accounts/'.length)
    const slash = rest.indexOf('/')
    return slash <= 0 ? null : configRule(rest.slice(slash + 1), rest.slice(0, slash))
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
  if (lower === 'settings.json') {
    const display = account === null ? '~/.claude/settings.json' : `~/.claude-accounts/${account}/settings.json`
    return { key: display.toLowerCase(), display, kind: 'settings', scope: GLOBAL_SCOPE }
  }
  const under = UNDER.exec(rest)
  if (under !== null && !FOREIGN_SKILLS.test(rest)) return make(({ skills: 'skill', hooks: 'hook', agents: 'agent' } as const)[under[1]!.toLowerCase() as 'skills'])
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
