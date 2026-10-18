// Pure: the page imports it to mark what a changelog draft changed.

export type PieceKind = 'same' | 'added' | 'removed'

export interface Piece {
  kind: PieceKind
  text: string
}

/** A line of the draft as the page shows it; `changed` — one line with some of its words replaced, the pieces mark them. */
export interface DiffLine {
  kind: PieceKind | 'changed'
  pieces: Piece[]
}

/** A removed and an added line count as one changed line when at least this share of their words is kept. */
const KEPT_SHARE = 0.5

/** The lines of `text` against `base`; `null` — nothing to compare with, every line unmarked. */
export function diffSection(base: string | null, text: string): DiffLine[] {
  const lines = text.split('\n')
  if (base === null) return lines.map((line) => whole('same', line))
  const out: DiffLine[] = []
  let removed: string[] = []
  let added: string[] = []
  const flush = () => {
    const paired = Math.min(removed.length, added.length)
    for (let at = 0; at < paired; at++) {
      const pieces = diffWords(removed[at]!, added[at]!)
      if (keptShare(pieces) >= KEPT_SHARE) out.push({ kind: 'changed', pieces })
      else out.push(whole('removed', removed[at]!), whole('added', added[at]!))
    }
    out.push(...removed.slice(paired).map((line) => whole('removed', line)), ...added.slice(paired).map((line) => whole('added', line)))
    removed = []
    added = []
  }
  for (const piece of diff(base.split('\n'), lines)) {
    if (piece.kind === 'removed') removed.push(piece.text)
    else if (piece.kind === 'added') added.push(piece.text)
    else {
      flush()
      out.push(whole('same', piece.text))
    }
  }
  flush()
  return out
}

const whole = (kind: PieceKind, text: string): DiffLine => ({ kind, pieces: [{ kind, text }] })

function diffWords(before: string, after: string): Piece[] {
  const tokens = (text: string) => text.split(/(\s+)/).filter((token) => token !== '')
  const pieces = diff(tokens(before), tokens(after))
  const out: Piece[] = []
  let removed = ''
  let added = ''
  const keep = (text: string) => {
    const last = out.at(-1)
    if (last?.kind === 'same') last.text += text
    else out.push({ kind: 'same', text })
  }
  const close = () => {
    const space = /\s+$/.exec(removed)?.[0] ?? /\s+$/.exec(added)?.[0] ?? ''
    if (removed.trimEnd() !== '') out.push({ kind: 'removed', text: removed.trimEnd() })
    if (added.trimEnd() !== '') out.push({ kind: 'added', text: added.trimEnd() })
    if (space !== '') keep(space)
    removed = ''
    added = ''
  }
  pieces.forEach((piece, index) => {
    if (piece.kind === 'removed') removed += piece.text
    else if (piece.kind === 'added') added += piece.text
    else if ((removed !== '' || added !== '') && piece.text.trim() === '' && pieces[index + 1] !== undefined && pieces[index + 1]!.kind !== 'same') {
      // A space between two changed words belongs to the change, so that the page marks "one session", not two words.
      if (removed !== '') removed += piece.text
      if (added !== '') added += piece.text
    } else {
      if (removed !== '' || added !== '') close()
      keep(piece.text)
    }
  })
  close()
  return out
}

function keptShare(pieces: Piece[]): number {
  const words = (kind: PieceKind) => pieces.filter((piece) => piece.kind === kind).flatMap((piece) => piece.text.split(/\s+/).filter(Boolean)).length
  const kept = words('same')
  const total = kept + Math.max(words('removed'), words('added'))
  return total === 0 ? 1 : kept / total
}

/** The longest common subsequence of the two lists, as runs of kept, removed and added items. */
function diff(before: string[], after: string[]): Piece[] {
  const rows = before.length + 1
  const cols = after.length + 1
  const table = new Uint32Array(rows * cols)
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i * cols + j] = before[i] === after[j] ? table[(i + 1) * cols + j + 1]! + 1 : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!)
    }
  }
  const out: Piece[] = []
  let [i, j] = [0, 0]
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      out.push({ kind: 'same', text: before[i]! })
      i++
      j++
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) out.push({ kind: 'removed', text: before[i++]! })
    else out.push({ kind: 'added', text: after[j++]! })
  }
  while (i < before.length) out.push({ kind: 'removed', text: before[i++]! })
  while (j < after.length) out.push({ kind: 'added', text: after[j++]! })
  return out
}
