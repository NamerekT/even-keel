import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HandoffReason } from './prompts.js'

const NOTE_LIMIT = 512 * 1024

export type SnapshotReason = 'relay' | 'restart' | 'checkpoint'

/** What a handoff gave the new session, kept for Tally: the note gets overwritten by the next handoff and goes with the worktree. */
export interface HandoffSnapshot {
  at: string
  task: string
  sessionId: string
  previous: string
  reason: SnapshotReason
  prompt: string
  notePath: string | null
  note: string | null
}

/** The launch journal's word for the handoff reason. */
export function snapshotReason(reason: HandoffReason): SnapshotReason {
  return reason === 'limit' || reason === 'mainFixed' ? 'relay' : reason
}

export async function readNote(path: string | null): Promise<string | null> {
  if (path === null) return null
  try {
    const text = await readFile(path, 'utf8')
    return text.length > NOTE_LIMIT ? text.slice(0, NOTE_LIMIT) : text
  } catch {
    return null
  }
}

export function saveSnapshot(dir: string, snapshot: HandoffSnapshot): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${snapshot.sessionId}.json`), JSON.stringify(snapshot, null, 2) + '\n')
}
