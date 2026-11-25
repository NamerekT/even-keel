import { HANDOFF_TOOL } from '../taskmcp/tools.js'
import type { FeedLine } from './transcript.js'

/** The handoff note of a task in a folder of its own: the worktree of a git project. */
export const HANDOFF_NOTE = '.temp/handoff.md'
/** The shared note or a task's own one (`noteFileOf`), as the last part of a written path. */
const NOTE = /(?:^|\/)(\.temp\/handoff(?:-[A-Za-z0-9._-]+)?\.md)$/
const WRITES = new Set(['Write', 'Edit', 'MultiEdit'])
const SHELLS = new Set(['Shell', 'Bash'])
const NEAR_END = 3

/**
 * The note a session of `task` writes before a handoff. A project without git (BTN-964) keeps every task in one
 * folder, so each task gets a note of its own there: the next task's note must not overwrite it or be read for it.
 */
export function noteFileOf(task: string, git: boolean): string {
  return git ? HANDOFF_NOTE : `.temp/handoff-${task.replace(/[^A-Za-z0-9._-]+/g, '-')}.md`
}

/**
 * Where a session of `task` puts its handoff note: `HANDOFF_TOOL` when the project's set brings the tasks server
 * (`kept`, BTN-1046) — the note goes to Even Keel and the checkpoint line names no path; otherwise its file.
 */
export function handoffNoteOf(task: string, git: boolean, kept: boolean): string {
  return kept ? HANDOFF_TOOL : noteFileOf(task, git)
}

/** The note a path names, as `.temp/handoff….md`; null — another file. */
const noteIn = (path: string): string | null => NOTE.exec(path.replace(/^['"]|['"]$/g, '').replace(/\\/g, '/'))?.[1] ?? null

/** Literal write targets only: quoted content mentioning the note and reads of it must not hold a turn. */
function shellNote(command: string): string | null {
  const tokens = command.match(/"(?:[^"`]|`.)*"|'(?:[^']|'')*'|>>?|[\n();|,]|[^\s"'();|,>]+/g) ?? []
  for (const [i, token] of tokens.entries()) {
    const target = shellTarget(tokens, i, token)
    const note = target === null ? null : noteIn(target)
    if (note !== null) return note
  }
  return null
}

function shellTarget(tokens: string[], i: number, token: string): string | null {
  if (/^>>?$/.test(token)) return tokens[i + 1] ?? ''
  if (/::(?:WriteAllText|WriteAllLines|AppendAllText)$/i.test(token) && tokens[i + 1] === '(') return tokens[i + 2] ?? ''
  if (!/^(?:Set-Content|Add-Content|Out-File)$/i.test(token)) return null
  if (i > 0 && ![';', '|', '\n', '(', '&', '&&'].includes(tokens[i - 1]!)) return null
  const next = tokens[i + 1] ?? ''
  return /^-(?:LiteralPath|Path|FilePath)$/i.test(next) ? tokens[i + 2] ?? '' : next
}

/** A call of the tasks server's `handoff_write`, by whatever name the agent gives an MCP tool (`mcp__…__`, `server_`, `server.`). */
const isKept = (name: string): boolean => name === HANDOFF_TOOL || name.endsWith(`_${HANDOFF_TOOL}`) || name.endsWith(`.${HANDOFF_TOOL}`)

/**
 * The note the turn wrote among its last few tool calls, as `.temp/handoff….md` or `HANDOFF_TOOL` for one kept with
 * Even Keel, the latest one first; null — none. With no `CHECKPOINT` line after it, the agent-bridge plugin's Stop hook
 * sends the session back to add the line for this note. `feed` is a whole transcript's. A message the turn took while
 * it ran (`midTurn`) does not start it: a reply to a chat message sent after the note still owes the line (BTN-1718).
 */
export function noteWritten(feed: readonly FeedLine[]): string | null {
  const start = feed.findLastIndex((line) => (line.kind === 'prompt' || line.kind === 'answer') && line.midTurn !== true)
  const tools = feed.slice(start + 1).filter((line) => line.kind === 'tool')
  for (const line of tools.slice(-NEAR_END).reverse()) {
    const name = line.name ?? ''
    const note = isKept(name) ? HANDOFF_TOOL : WRITES.has(name) ? noteIn(line.subject ?? '') : SHELLS.has(name) ? shellNote(line.detail ?? '') : null
    if (note !== null) return note
  }
  return null
}

export const noteAtEnd = (feed: readonly FeedLine[]): boolean => noteWritten(feed) !== null
