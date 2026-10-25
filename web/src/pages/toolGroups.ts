import type { FeedLine } from '../../../src/sessions/transcript.js'

/** Events further apart than this get a time mark between them. */
const GAP_MS = 5 * 60_000

export type ToolKind = 'edit' | 'read' | 'search' | 'run' | 'other'

const KINDS: Record<string, ToolKind> = {
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'edit',
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  WebSearch: 'search',
  Bash: 'run',
  PowerShell: 'run',
  Shell: 'run',
}

export function toolKind(name: string | undefined): ToolKind {
  return (name === undefined ? undefined : KINDS[name]) ?? 'other'
}

/** A tool line with the error its result came back with. */
export interface Call {
  line: FeedLine
  failure: string | null
  /** The failure is a command the end of its turn killed. */
  interrupted?: true
}

/** What the chat lays out: a line of its own, the calls between two texts, or a mark of the time after a pause. */
export type FeedEntry = { kind: 'line'; line: FeedLine } | { kind: 'tools'; calls: Call[] } | { kind: 'gap'; at: string }

export interface EditTotal {
  added: number
  removed: number
}

export interface GroupSummary {
  /** Files for edits and reads, calls for the rest. */
  counts: Record<ToolKind, number>
  failed: number
  /** `null` when no call of the group edits. */
  size: EditTotal | null
}

/**
 * The lines of a transcript as the chat shows them: calls in a row are one group, and the image and failed lines of a
 * call go into it. A question stays a line of its own, as it shows as a card.
 */
export function feedEntries(lines: FeedLine[]): FeedEntry[] {
  const calls = new Map<string, Call>()
  for (const line of lines) if (isCall(line) && line.tool !== undefined) calls.set(line.tool, { line, failure: null })
  for (const line of lines) {
    const call = line.kind === 'failed' ? calls.get(line.tool ?? '') : undefined
    if (call === undefined) continue
    call.failure = line.text
    if (line.interrupted) call.interrupted = true
  }

  const entries: FeedEntry[] = []
  let last: number | null = null
  const mark = (at: string) => {
    const time = at === '' ? NaN : Date.parse(at)
    if (Number.isNaN(time)) return
    if (last !== null && time - last > GAP_MS) entries.push({ kind: 'gap', at })
  }
  const seen = (at: string) => {
    const time = at === '' ? NaN : Date.parse(at)
    if (!Number.isNaN(time)) last = time
  }
  for (const line of lines) {
    if ((line.kind === 'image' || line.kind === 'failed') && calls.has(line.tool ?? '')) continue
    if (isCall(line)) {
      const call = (line.tool === undefined ? undefined : calls.get(line.tool)) ?? { line, failure: null }
      const open = entries.at(-1)
      if (open?.kind === 'tools') open.calls.push(call)
      else {
        mark(line.at)
        entries.push({ kind: 'tools', calls: [call] })
      }
    } else {
      mark(line.at)
      entries.push({ kind: 'line', line })
    }
    seen(line.at)
  }
  return entries
}

export function summarize(calls: Call[]): GroupSummary {
  const counts: Record<ToolKind, number> = { edit: 0, read: 0, search: 0, run: 0, other: 0 }
  const files: Record<'edit' | 'read', Set<string>> = { edit: new Set(), read: new Set() }
  for (const { line } of calls) {
    const kind = toolKind(line.name)
    if ((kind === 'edit' || kind === 'read') && line.subject !== undefined) {
      if (files[kind].has(line.subject)) continue
      files[kind].add(line.subject)
    }
    counts[kind] += 1
  }
  return { counts, failed: calls.filter((call) => call.failure !== null && !call.interrupted).length, size: editTotals(calls.map((call) => call.line)) }
}

/** The lines the edits of `lines` add and remove; `null` when none edits. */
export function editTotals(lines: FeedLine[]): EditTotal | null {
  const edits = lines.filter((line) => line.kind === 'tool' && (line.added !== undefined || line.removed !== undefined))
  if (edits.length === 0) return null
  return edits.reduce((sum, line) => ({ added: sum.added + (line.added ?? 0), removed: sum.removed + (line.removed ?? 0) }), { added: 0, removed: 0 })
}

function isCall(line: FeedLine): boolean {
  return line.kind === 'tool' && line.ask === undefined && line.share === undefined
}
