/**
 * Fields the CLI writes into a record's frontmatter by itself (BTN-1686): they change with every save and say nothing
 * about the fact, so two versions that differ only in them are one record, and an edit of them alone never conflicts.
 */
export const SERVICE_FIELDS = ['originSessionId', 'modified', 'node_type'] as const

const SERVICE_LINE = new RegExp(`^\\s*(${SERVICE_FIELDS.join('|')}):\\s*(.*?)\\s*$`)

/** The index of the frontmatter's closing `---`, or -1 when the text has none. */
function headEnd(lines: readonly string[]): number {
  if (lines[0]?.replace(/^﻿/, '').trimEnd() !== '---') return -1
  for (let n = 1; n < lines.length; n++) if (lines[n]!.trimEnd() === '---') return n
  return -1
}

function serviceLines(text: string): Map<string, string> {
  const lines = text.split('\n')
  const end = headEnd(lines)
  const found = new Map<string, string>()
  for (let n = 1; n < end; n++) {
    const match = SERVICE_LINE.exec(lines[n]!)
    if (match !== null && !found.has(match[1]!)) found.set(match[1]!, lines[n]!)
  }
  return found
}

/** `text` with the service fields of `from`: each of its own takes the line of `from`, or goes when `from` has none. */
export function withServiceOf(text: string, from: string): string {
  const lines = text.split('\n')
  const end = headEnd(lines)
  if (end < 0) return text
  const theirs = serviceLines(from)
  return lines
    .flatMap((line, n) => {
      const match = n > 0 && n < end ? SERVICE_LINE.exec(line) : null
      if (match === null) return [line]
      const other = theirs.get(match[1]!)
      return other === undefined ? [] : [other]
    })
    .join('\n')
}

/** The frontmatter's `modified` in milliseconds; `null` — none, or not a date. */
export function modifiedOf(text: string): number | null {
  const lines = text.split('\n')
  const end = headEnd(lines)
  for (let n = 1; n < end; n++) {
    const match = SERVICE_LINE.exec(lines[n]!)
    if (match?.[1] !== 'modified') continue
    const time = Date.parse(match[2]!.replace(/^(["'])(.*)\1$/, '$2'))
    return Number.isNaN(time) ? null : time
  }
  return null
}

/** Two versions of one file that met in a sync, and their common one when they have it. */
export interface Sides {
  /** `null` — both copies added the file independently: the first meeting of two copies without a common history. */
  base: string | null
  own: string
  remote: string
  /** When each side's version was committed, in milliseconds: the time of a side whose frontmatter has no `modified`. */
  ownCommitted: number
  remoteCommitted: number
}

export interface Settled {
  text: string
  /**
   * `same` — equal but for the service fields; `newer` — no common version, the newer kept; `merged` — a three-way
   * merge went clean; `conflict` — the same lines changed on both sides, the newer kept and the other to be merged.
   */
  kind: 'same' | 'newer' | 'merged' | 'conflict'
  newer: 'own' | 'remote'
}

/** A three-way merge of texts: the result, `null` when the same lines changed on both sides. */
export type MergeTexts = (base: string, own: string, remote: string) => Promise<string | null>

/**
 * The text a file of two versions settles on (BTN-1686). The service fields are made the newer side's in all three
 * texts first, so they neither tell two versions apart nor conflict. A side is newer by its `modified`, else by its
 * commit; a tie goes to the own side.
 */
export async function settleTexts(sides: Sides, merge: MergeTexts): Promise<Settled> {
  const ownTime = modifiedOf(sides.own) ?? sides.ownCommitted
  const remoteTime = modifiedOf(sides.remote) ?? sides.remoteCommitted
  const newer = remoteTime > ownTime ? 'remote' : 'own'
  const winner = newer === 'own' ? sides.own : sides.remote
  const own = withServiceOf(sides.own, winner)
  const remote = withServiceOf(sides.remote, winner)
  if (own === remote) return { text: winner, kind: 'same', newer }
  if (sides.base === null) return { text: winner, kind: 'newer', newer }
  const merged = await merge(withServiceOf(sides.base, winner), own, remote)
  return merged === null ? { text: winner, kind: 'conflict', newer } : { text: merged, kind: 'merged', newer }
}
