import { readFileSync, realpathSync } from 'node:fs'
import { samePath, workingFolder } from '../paths.js'
import { writeAtomic } from '../storage/atomic.js'
import { fail } from '../notice/notice.js'

const HEADER = /^\s*\[\s*projects\s*\.\s*(?:'([^']*)'|"((?:[^"\\]|\\.)*)")\s*\]\s*(?:#.*)?$/
const ANY_TABLE = /^\s*\[/
const LEVEL = /^\s*trust_level\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/
/** `projects` written as an inline table, a `[projects]` table or dotted keys at the root: no safe place for a table. */
const OTHER_SHAPE = /^\s*(?:\[\s*projects\s*\]|projects\s*[.=])/

/** What `withProjectTrust` found: the folder trusted already, marked untrusted by the user, or the new text. */
export type TrustEdit = { kind: 'trusted' } | { kind: 'refused' } | { kind: 'unknownShape' } | { kind: 'write'; text: string }

/** The folder as Codex keys it in `[projects.'…']`: its real path, on Windows in lower case with backslashes. */
export function projectKey(folder: string, platform: NodeJS.Platform = process.platform, real: (path: string) => string = realpathSync.native): string {
  const path = workingFolder(folder, platform, real)
  return platform === 'win32' ? path.replaceAll('/', '\\').toLowerCase() : path
}

const quoted = (key: string) => (/['\u0000-\u001f]/.test(key) ? JSON.stringify(key) : `'${key}'`)

/**
 * The account's `config.toml` text with the folder trusted, edited by lines so that comments and order stay. An entry
 * under any spelling of the folder counts; a level the user set to anything but `trusted` is kept.
 */
export function withProjectTrust(text: string, folder: string, key: string, platform: NodeJS.Platform = process.platform): TrustEdit {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  let entry: number | undefined
  for (const [i, row] of lines.entries()) {
    const header = HEADER.exec(row)
    if (header === null) {
      if (OTHER_SHAPE.test(row)) return { kind: 'unknownShape' }
      continue
    }
    const name = header[1] ?? (JSON.parse(`"${header[2]}"`) as string)
    if (!samePath(name, folder, platform)) continue
    for (const line of lines.slice(i + 1)) {
      if (ANY_TABLE.test(line)) break
      const level = LEVEL.exec(line)
      if (level !== null) return (level[1] ?? level[2]) === 'trusted' ? { kind: 'trusted' } : { kind: 'refused' }
    }
    entry ??= i
  }
  const line = 'trust_level = "trusted"'
  if (entry !== undefined) return { kind: 'write', text: [...lines.slice(0, entry + 1), line, ...lines.slice(entry + 1)].join(eol) }
  const table = `[projects.${quoted(key)}]${eol}${line}${eol}`
  if (text === '') return { kind: 'write', text: table }
  return { kind: 'write', text: `${text}${text.endsWith('\n') ? '' : eol}${eol}${table}` }
}

/**
 * Trust the project's folder in a Codex account's `config.toml`: Codex reads a folder's `.codex/rules` — Protection
 * and the git ban — only in a trusted project, and worktrees inside the folder take its trust (BTN-1174). A folder the
 * user marked untrusted, or a file whose `projects` are not written as tables, is left with a line in the log.
 */
export function trustProject(file: string, folder: string, platform: NodeJS.Platform = process.platform): void {
  try {
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const edit = withProjectTrust(text.replace(/^﻿/, ''), folder, projectKey(folder, platform), platform)
    if (edit.kind === 'refused') console.warn(`codex: ${file} marks ${folder} untrusted, so its sessions run without the .codex/rules of Protection`)
    if (edit.kind === 'unknownShape') console.warn(`codex: ${file} writes projects not as [projects.'…'] tables; trust ${folder} there by hand, or its sessions run without the .codex/rules of Protection`)
    if (edit.kind === 'write') writeAtomic(file, edit.text)
  } catch (error) {
    throw fail('codex.trustWriteFailed', { folder, file }, { detail: error instanceof Error ? error.message : String(error) }, { cause: error })
  }
}
