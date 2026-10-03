import { execFile } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AccountHome } from '../../src/account/homes.js'
import { canon, claudeJsonRules, isSkillFile, ruleFileOf, stripFrontmatter, type RuleFile } from './rules.js'

const run = promisify(execFile)
const MAX_BYTES = 1024 * 1024
export const MAX_CLAUDE_JSON_BYTES = 64 * 1024 * 1024
const SKIPPED_DIRS = new Set(['node_modules', '.git', '__pycache__'])
export const PROJECT_SPECS =['CLAUDE.md', '**/CLAUDE.md', '.claude/skills/**', '.claude/agents/**', '.claude/settings.json']

export interface RuleSource {
  path: string
  file: RuleFile
}

export interface FileInfo {
  size: number
  mtime: string
}

// Real rule files on disk: each account folder (account copies of junctions are skipped, the global folder
// has the originals) and the main checkout of each project, listed by git so ignored caches are never walked.
export async function ruleSources(homes: AccountHome[], projects: string[], home: string, log: (message: string) => void): Promise<RuleSource[]> {
  const paths: string[] = [join(home, '.claude.json')]
  await walk(join(home, '.githooks'), false, paths)
  for (const account of homes) {
    paths.push(join(account.dir, 'CLAUDE.md'), join(account.dir, 'settings.json'))
    if (!account.global) paths.push(join(account.dir, '.claude.json'))
    for (const name of ['skills', 'hooks', 'agents']) await walk(join(account.dir, name), account.global, paths)
    for (const slug of await names(join(account.dir, 'projects'))) {
      const memory = join(account.dir, 'projects', slug, 'memory')
      if (!account.global && (await isLink(memory))) continue
      for (const file of await names(memory)) if (file.toLowerCase().endsWith('.md')) paths.push(join(memory, file))
    }
  }
  for (const repo of projects) {
    // Git ignores it, so ls-files never lists it.
    paths.push(join(repo, '.claude', 'settings.local.json'))
    try {
      const { stdout } = await run('git', ['-C', repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...PROJECT_SPECS], {
        maxBuffer: 16 * 1024 * 1024,
      })
      for (const file of stdout.split('\0')) if (file !== '') paths.push(join(repo, file))
    } catch (error) {
      log(`tally: rule files of ${repo}: ${(error as Error).message.split('\n')[0]}`)
    }
  }
  const seen = new Set<string>()
  const sources: RuleSource[] = []
  for (const path of paths) {
    const file = ruleFileOf(path, home)
    if (file === null || seen.has(path.toLowerCase())) continue
    seen.add(path.toLowerCase())
    sources.push({ path, file })
  }
  return sources
}

export async function infoOf(path: string): Promise<FileInfo | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? { size: info.size, mtime: info.mtime.toISOString() } : null
  } catch {
    return null
  }
}

// The stored text of a rule file: a skill's SKILL.md without frontmatter, as sessions get it, and only the rules part
// of .claude.json (it grows with every session, so its size limit is higher); null for binary or huge files.
export async function ruleText(source: RuleSource, info: FileInfo): Promise<string | null> {
  const claudeJson = isClaudeJson(source.file)
  if (info.size > (claudeJson ? MAX_CLAUDE_JSON_BYTES : MAX_BYTES)) return null
  return textOf(source.file, await readFile(source.path, 'utf8'))
}

export function textOf(file: RuleFile, text: string): string | null {
  if (text.includes('\u0000')) return null
  if (isClaudeJson(file)) return claudeJsonRules(text)
  return isSkillFile(file) ? stripFrontmatter(text) : canon(text).toWellFormed()
}

const isClaudeJson = (file: RuleFile) => file.key.endsWith('.claude.json')

export function readBackup(path: string): string | null {
  try {
    return statSync(path).size > MAX_CLAUDE_JSON_BYTES ? null : readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function skillsOf(sources: RuleSource[]): Map<string, RuleFile> {
  const skills = new Map<string, RuleFile>()
  for (const { file } of sources) {
    if (!isSkillFile(file)) continue
    const name = file.display.split('/').at(-2)!
    if (!skills.has(name) || file.scope === 'global') skills.set(name, file)
  }
  return skills
}

async function walk(dir: string, followLinks: boolean, paths: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    let isDir = entry.isDirectory()
    if (entry.isSymbolicLink()) {
      if (!followLinks) continue
      isDir = (await stat(path).catch(() => null))?.isDirectory() ?? false
    }
    if (isDir) {
      if (!SKIPPED_DIRS.has(entry.name)) await walk(path, followLinks, paths)
    } else paths.push(path)
  }
}

async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

async function isLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink()
  } catch {
    return true
  }
}
