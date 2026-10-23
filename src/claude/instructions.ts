import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The `AGENTS.md` of a folder that has no `CLAUDE.md` of its own: Claude Code does not read it by itself (CLI 2.1.309,
 * BTN-340), so a chain session gets it appended to its system prompt. `undefined` — the folder's `CLAUDE.md` or nothing.
 */
export function agentsFallback(cwd: string): string | undefined {
  if (existsSync(join(cwd, 'CLAUDE.md')) || existsSync(join(cwd, '.claude', 'CLAUDE.md'))) return undefined
  const file = join(cwd, 'AGENTS.md')
  return existsSync(file) ? file : undefined
}
