import type { FeedLine } from './transcript.js'

const NOTE = /(^|\/)\.temp\/handoff\.md$/
/** Claude Code's file tools; a Codex file change is an `Edit` line of the rollout. */
const WRITES = new Set(['Write', 'Edit', 'MultiEdit'])
const NEAR_END = 3

/**
 * The turn wrote `.temp/handoff.md` among its last few tool calls: with no `CHECKPOINT` line after it, the checkpoint
 * plugin's Stop hook sends the session back to add it. `feed` is a whole transcript's.
 */
export function noteAtEnd(feed: readonly FeedLine[]): boolean {
  const start = feed.findLastIndex((line) => line.kind === 'prompt' || line.kind === 'answer')
  const tools = feed.slice(start + 1).filter((line) => line.kind === 'tool')
  return tools.slice(-NEAR_END).some((line) => WRITES.has(line.name ?? '') && NOTE.test((line.subject ?? '').replace(/\\/g, '/')))
}
