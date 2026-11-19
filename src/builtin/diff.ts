import type { DiffLine } from '../tracker/history.js'

/** Unchanged lines kept on each side of a change; the rest of an unchanged stretch is only counted. */
const CONTEXT = 2
/** Above this many cells of the alignment table the texts are compared as all removed and all added. */
const MAX_CELLS = 4_000_000

const linesOf = (text: string): string[] => (text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n'))

/** The difference of two descriptions line by line (BTN-1112): what the history keeps instead of both texts. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const [a, b] = [linesOf(before), linesOf(after)]
  return withContext(a.length * b.length > MAX_CELLS ? [...a.map(removed), ...b.map(added)] : aligned(a, b))
}

const removed = (text: string): DiffLine => ({ kind: 'removed', text })
const added = (text: string): DiffLine => ({ kind: 'added', text })

/** Every line, by the longest common subsequence; a removed line goes before the added one that replaces it. */
function aligned(a: string[], b: string[]): DiffLine[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const [x, y] = [a.slice(start, a.length - end), b.slice(start, b.length - end)]
  const width = y.length + 1
  const common = new Uint32Array((x.length + 1) * width)
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      common[i * width + j] = x[i] === y[j] ? common[(i + 1) * width + j + 1]! + 1 : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!)
    }
  }
  const middle: DiffLine[] = []
  let [i, j] = [0, 0]
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      middle.push({ kind: 'same', text: x[i]! })
      i++
      j++
    } else if (j >= y.length || (i < x.length && common[(i + 1) * width + j]! >= common[i * width + j + 1]!)) {
      middle.push(removed(x[i++]!))
    } else {
      middle.push(added(y[j++]!))
    }
  }
  const same = (text: string): DiffLine => ({ kind: 'same', text })
  return [...a.slice(0, start).map(same), ...middle, ...a.slice(a.length - end).map(same)]
}

function withContext(lines: DiffLine[]): DiffLine[] {
  if (lines.every((line) => line.kind === 'same')) return []
  const near = new Array<boolean>(lines.length).fill(false)
  for (const [index, line] of lines.entries()) {
    if (line.kind === 'same') continue
    for (let at = Math.max(0, index - CONTEXT); at <= Math.min(lines.length - 1, index + CONTEXT); at++) near[at] = true
  }
  const result: DiffLine[] = []
  let skipped = 0
  for (const [index, line] of lines.entries()) {
    if (near[index]) {
      if (skipped > 0) result.push({ kind: 'skipped', lines: skipped })
      skipped = 0
      result.push(line)
    } else {
      skipped++
    }
  }
  if (skipped > 0) result.push({ kind: 'skipped', lines: skipped })
  return result
}
