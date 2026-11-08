import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { isInside } from '../paths.js'

const RULES = ['CLAUDE.md', join('.claude', 'CLAUDE.md')]

/**
 * The `AGENTS.md` of a folder that has no `CLAUDE.md` of its own, when the CLI will not read it: it reads a lone
 * `AGENTS.md` by itself (CLI 2.1.309 and up, BTN-833), but not once a folder above holds one of its rules files — on
 * Windows `~/.claude/CLAUDE.md` too, once the account is another folder (CLI 2.1.319, BTN-869). A chain session then
 * gets the file appended to its system prompt. `undefined` — the CLI reads the folder's rules by itself, or there are none.
 */
export function agentsFallback(cwd: string, exists: (path: string) => boolean = existsSync): string | undefined {
  if (RULES.some((name) => exists(join(cwd, name)))) return undefined
  const file = join(cwd, 'AGENTS.md')
  return exists(file) && claudeRulesAbove(cwd, exists) !== null ? file : undefined
}

/**
 * A rules file of Claude's in a folder above `folder` that the CLI reads, or `null`. The folders of the main checkout
 * a git worktree sits in do not count: in such a worktree the CLI read its `AGENTS.md` and not the checkout's
 * `CLAUDE.md` (CLI 2.1.319, BTN-833). Every folder above the checkout does.
 */
export function claudeRulesAbove(folder: string, exists: (path: string) => boolean = existsSync): string | null {
  const checkout = mainCheckoutOf(folder)
  for (let dir = dirname(folder); ; dir = dirname(dir)) {
    if (checkout === null || !isInside(dir, checkout)) {
      const found = RULES.map((name) => join(dir, name)).find(exists)
      if (found !== undefined) return found
    }
    if (dirname(dir) === dir) return null
  }
}

/** The main checkout of the git worktree `folder`, read from its `.git` file; `null` for a checkout or no git. */
function mainCheckoutOf(folder: string): string | null {
  try {
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(folder, '.git'), 'utf8'))?.[1]?.trim()
    if (gitdir === undefined) return null
    const dir = resolve(folder, gitdir)
    const common = resolve(dir, readFileSync(join(dir, 'commondir'), 'utf8').trim())
    return basename(common) === '.git' ? dirname(common) : null
  } catch {
    return null
  }
}
