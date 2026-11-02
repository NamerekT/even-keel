/**
 * The account folder's own instructions and memory in a CLI capture (BTN-724). Run in a working account folder, a
 * session gets that folder's global `CLAUDE.md`/`AGENTS.md`, Claude's auto-memory index, Codex's memory summary and the
 * list of the folder's own skills in its context, and anonymization replaces only paths, emails, ids and credentials: a capture that holds them is not saved.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** A line this long is the file's own text, not a phrase any transcript may hold. */
const MIN_LINE = 40

export interface AccountText {
  file: string
  /** The file's trimmed lines of at least `MIN_LINE` characters. */
  lines: string[]
}

/**
 * The global instructions and rules, Claude's auto-memory of every project, Codex's memories and the folder's own
 * skills, whose descriptions the session's skill list holds without the `description:` key.
 */
export function accountTexts(dir: string): AccountText[] {
  const files = [
    ...['CLAUDE.md', 'AGENTS.md', 'AGENTS.override.md'].map((name) => join(dir, name)).filter(isFile),
    ...markdownIn(join(dir, 'rules')),
    ...folders(join(dir, 'projects')).flatMap((project) => markdownIn(join(project, 'memory'))),
    ...markdownIn(join(dir, 'memories')),
    ...folders(join(dir, 'skills')).map((skill) => join(skill, 'SKILL.md')).filter(isFile),
  ]
  return files.flatMap((file) => {
    const lines = [...new Set(readFileSync(file, 'utf8').split(/\r?\n/)
      .map((line) => line.trim().replace(/^description:\s*/, '').replace(/^(["'])(.*)\1$/, '$2'))
      .filter((line) => line.length >= MIN_LINE))]
    return lines.length === 0 ? [] : [{ file, lines }]
  })
}

/** The files whose lines the value holds anywhere, JSON nested in its strings and event lines included. */
export function accountLeaks(value: unknown, texts: AccountText[]): string[] {
  const text = plainText(value).join('\n')
  return texts.filter((each) => each.lines.some((line) => text.includes(line))).map((each) => each.file)
}

function plainText(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    const nested = parseObject(value)
    if (nested !== undefined) plainText(nested, out)
    else for (const line of value.split('\n')) {
      const event = parseObject(line)
      if (event === undefined) out.push(line)
      else plainText(event, out)
    }
  } else if (Array.isArray(value)) for (const item of value) plainText(item, out)
  else if (value !== null && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    out.push(key)
    plainText(item, out)
  }
  return out
}

function parseObject(text: string): object | undefined {
  if (!/^\s*[[{]/.test(text)) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Links are followed: an account folder links its memory to a shared store (`docs/accounts.md`). */
function stat(path: string) {
  return existsSync(path) ? statSync(path) : undefined
}

function isFile(path: string): boolean {
  return stat(path)?.isFile() === true
}

function folders(dir: string): string[] {
  if (stat(dir)?.isDirectory() !== true) return []
  return readdirSync(dir).map((name) => join(dir, name)).filter((path) => stat(path)?.isDirectory() === true)
}

/** Markdown files of the folder and its subfolders, hidden ones (`.git`) left out. */
function markdownIn(dir: string): string[] {
  if (stat(dir)?.isDirectory() !== true) return []
  return readdirSync(dir).filter((name) => !name.startsWith('.')).flatMap((name) => {
    const path = join(dir, name)
    const found = stat(path)
    if (found?.isDirectory() === true) return markdownIn(path)
    return found?.isFile() === true && name.endsWith('.md') ? [path] : []
  })
}
