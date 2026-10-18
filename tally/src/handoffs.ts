import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { LaunchEntry } from '../../src/chain/dispatcher.js'
import type { HandoffSnapshot } from '../../src/chain/snapshots.js'
import { blocksOf, parseEntry, type Entry } from '../../src/sessions/entry.js'
import type { Source } from './load.js'
import { firstPrompt } from './prompt.js'

const HANDOFF_REASONS = new Set(['relay', 'checkpoint', 'restart'])
// The note line of the handoff prompt (PROMPTS.*.note in src/chain/prompts.ts).
const NOTE_LINE = /^- (?:Handoff note|Записка о передаче): (.+?) — /m

export interface HandoffRow extends HandoffSnapshot {
  source: 'even-keel' | 'transcript'
}

export interface HandoffStore {
  handoffSources(): Promise<Map<string, string>>
  addHandoffs(rows: HandoffRow[]): Promise<number>
}

export function notePathOf(prompt: string): string | null {
  return NOTE_LINE.exec(prompt)?.[1] ?? null
}

/** The note as the old session left it: its last Write, then the edits after it; an edit whose text is not there failed in the session too. */
export function noteFromWrites(entries: Iterable<Entry>, path: string): string | null {
  const key = pathKey(path)
  let note: string | null = null
  for (const entry of entries) {
    if (entry.type !== 'assistant') continue
    for (const block of blocksOf(entry.message?.content)) {
      const input = block.input
      if (block.type !== 'tool_use' || input === undefined || typeof input.file_path !== 'string' || pathKey(input.file_path) !== key) continue
      if (block.name === 'Write' && typeof input.content === 'string') note = input.content
      if (block.name === 'Edit' && note !== null) note = edited(note, input)
    }
  }
  return note
}

export function rowOfSnapshot(raw: unknown): HandoffRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Partial<Record<keyof HandoffSnapshot, unknown>>
  const text = (field: unknown) => (typeof field === 'string' ? field : null)
  const [sessionId, previous, task, prompt] = [text(value.sessionId), text(value.previous), text(value.task), text(value.prompt)]
  if (sessionId === null || previous === null || task === null || prompt === null) return null
  return {
    at: text(value.at) ?? '',
    task,
    sessionId,
    previous,
    reason: (text(value.reason) ?? 'checkpoint') as HandoffRow['reason'],
    prompt,
    notePath: text(value.notePath),
    note: text(value.note),
    source: 'even-keel',
  }
}

/** A handoff from before the snapshots: the prompt from the new session's transcript, the note from the old one's writes. */
export function rowOfTranscripts(
  launch: LaunchEntry,
  successor: Iterable<Entry>,
  predecessor: (notePath: string) => Iterable<Entry> | null,
): HandoffRow | null {
  const prompt = firstPrompt(successor, Infinity)
  if (prompt === null || launch.previous === undefined) return null
  const notePath = notePathOf(prompt)
  const written = notePath === null ? null : predecessor(notePath)
  return {
    at: launch.at,
    task: launch.task,
    sessionId: launch.sessionId,
    previous: launch.previous,
    reason: launch.reason as HandoffRow['reason'],
    prompt,
    notePath,
    note: notePath === null || written === null ? null : noteFromWrites(written, notePath),
    source: 'transcript',
  }
}

/** Snapshots Even Keel saved in its database, then the journal's handoffs without one, from transcripts while they last. */
export async function refreshHandoffs(db: HandoffStore, snapshots: HandoffSnapshot[], sources: Source[], launches: LaunchEntry[]): Promise<number> {
  const known = await db.handoffSources()
  const rows: HandoffRow[] = []
  const saved = new Set<string>()
  for (const snapshot of snapshots) {
    saved.add(snapshot.sessionId)
    if (known.get(snapshot.sessionId) === 'even-keel') continue
    const row = rowOfSnapshot(snapshot)
    if (row !== null) rows.push(row)
  }

  const transcripts = new Map<string, string>()
  for (const source of sources) {
    if (!/[\\/]subagents[\\/]/.test(source.path)) transcripts.set(basename(source.path, '.jsonl'), source.path)
  }
  for (const launch of launches) {
    if (!HANDOFF_REASONS.has(launch.reason ?? '') || launch.previous === undefined) continue
    if (known.has(launch.sessionId) || saved.has(launch.sessionId)) continue
    const own = transcripts.get(launch.sessionId)
    if (own === undefined) continue
    const before = transcripts.get(launch.previous)
    const row = rowOfTranscripts(launch, entriesOf(own), (note) => (before === undefined ? null : entriesOf(before, note.split(/[\\/]/).pop())))
    if (row !== null) rows.push(row)
  }
  return rows.length === 0 ? 0 : db.addHandoffs(rows)
}

function edited(note: string, input: Record<string, unknown>): string {
  const { old_string: from, new_string: to } = input
  if (typeof from !== 'string' || typeof to !== 'string' || from === '' || !note.includes(from)) return note
  return input.replace_all === true ? note.split(from).join(to) : note.replace(from, () => to)
}

function pathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

function* entriesOf(path: string, needle?: string): Generator<Entry> {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    if (needle !== undefined && !line.includes(needle)) continue
    const entry = parseEntry(line)
    if (entry !== undefined) yield entry
  }
}
