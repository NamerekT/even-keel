import { createHash } from 'node:crypto'

/** The kinds of a memory record, as Claude Code's auto-memory writes them. */
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

/** One fact of a project's memory (BTN-1029): what a session reads and writes. */
export interface MemoryFact {
  name: string
  description: string
  /** One of `MEMORY_TYPES` when a session wrote it; a file of the hub's folder may carry anything. */
  type: string
  body: string
}

/** A fact as the hub keeps it: its version grows with each change, a deleted one stays as a mark. */
export interface MemoryRecord extends MemoryFact {
  version: number
  deleted: boolean
  /** The file of the hub's memory folder that mirrors it; `null` — not mirrored. */
  file: string | null
  /** The hash of that file as last mirrored either way (`fileHash`). */
  fileHash: string | null
  /** The task whose session wrote it last; `null` — a session started by hand, through the folder. */
  task: string | null
  machine: string | null
  /** ISO */
  at: string
}

/** A name a session may give a record: it is also the file name in the hub's folder. */
export const MEMORY_NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/

export function fileHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** A record as the CLI's auto-memory writes a file: frontmatter with name, description and type, then the body. */
export function memoryFile(fact: MemoryFact): string {
  const body = fact.body.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  return `---\nname: ${oneLine(fact.name)}\ndescription: ${oneLine(fact.description)}\nmetadata:\n  type: ${oneLine(fact.type)}\n---\n\n${body}\n`
}

/**
 * A file of the memory folder as a fact: the frontmatter's `name`, `description` and `type` (also under `metadata:`),
 * the rest as the body. A file without frontmatter is named by `stem` and described by its first line.
 */
export function parseMemoryFile(text: string, stem: string): MemoryFact {
  const normal = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const head = /^---\n([\s\S]*?)\n---\n?/.exec(normal)
  if (head === null) {
    const body = normal.trim()
    return { name: stem, description: body.split('\n', 1)[0]?.replace(/^#+\s*/, '').trim() ?? '', type: 'project', body }
  }
  const fields = new Map<string, string>()
  for (const line of head[1]!.split('\n')) {
    const match = /^\s*([A-Za-z_]+):\s*(.*)$/.exec(line)
    if (match !== null && match[2] !== '' && !fields.has(match[1]!)) fields.set(match[1]!, unquote(match[2]!.trim()))
  }
  return {
    name: fields.get('name') || stem,
    description: fields.get('description') ?? '',
    type: fields.get('type') ?? 'project',
    body: normal.slice(head[0].length).replace(/^\n+/, '').replace(/\n+$/, ''),
  }
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value)
  return quoted === null ? value : quoted[2]!
}

function oneLine(value: string): string {
  return value.replace(/\s*\n\s*/g, ' ').trim()
}

/** The index line of a record, as a session's prompt and `memory_list` give it. */
export function indexLine(record: Pick<MemoryRecord, 'name' | 'description'>): string {
  return record.description === '' ? `- ${record.name}` : `- ${record.name} — ${record.description}`
}

const WORD = /[\p{L}\p{N}]+/gu

function wordsOf(fact: Pick<MemoryFact, 'name' | 'description'>): Set<string> {
  const words = `${fact.name.replace(/[-_.]/g, ' ')} ${fact.description}`.toLowerCase().match(WORD) ?? []
  return new Set(words.filter((word) => word.length >= 3))
}

/**
 * The live records that look like the same fact as `fact` (BTN-1029, "the index grows"): at least two words of name and
 * description in common, half of the shorter one's; closest first, five at most.
 */
export function similarRecords<R extends MemoryRecord>(fact: Pick<MemoryFact, 'name' | 'description'>, records: readonly R[]): R[] {
  const own = wordsOf(fact)
  const scored = records.flatMap((record) => {
    if (record.deleted || record.name === fact.name) return []
    const theirs = wordsOf(record)
    const common = [...own].filter((word) => theirs.has(word)).length
    const share = common / Math.max(1, Math.min(own.size, theirs.size))
    return common >= 2 && share >= 0.5 ? [{ record, share }] : []
  })
  return scored.sort((a, b) => b.share - a.share).slice(0, 5).map((each) => each.record)
}
