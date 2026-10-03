export interface DiffHunk {
  oldStart: number
  newStart: number
  lines: string[]
}

export interface LineDiff {
  added: number
  removed: number
  hunks: DiffHunk[]
}

const CONTEXT = 3
const MAX_CELLS = 25_000_000

type Op = [kind: ' ' | '-' | '+', text: string]

const split = (text: string | null): string[] => (text === null || text === '' ? [] : text.split('\n'))

export function lineDiff(before: string | null, after: string | null): LineDiff {
  const ops = diffOps(split(before), split(after))
  return {
    added: ops.filter(([kind]) => kind === '+').length,
    removed: ops.filter(([kind]) => kind === '-').length,
    hunks: hunksOf(ops),
  }
}

function diffOps(a: string[], b: string[]): Op[] {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  return [
    ...a.slice(0, head).map((text): Op => [' ', text]),
    ...middle(midA, midB),
    ...a.slice(a.length - tail).map((text): Op => [' ', text]),
  ]
}

function middle(a: string[], b: string[]): Op[] {
  if (a.length * b.length > MAX_CELLS) return [...a.map((text): Op => ['-', text]), ...b.map((text): Op => ['+', text])]
  const width = b.length + 1
  const common = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i * width + j] = a[i] === b[j] ? common[(i + 1) * width + j + 1]! + 1 : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!)
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push([' ', a[i]!])
      i++
      j++
    } else if (i < a.length && (j === b.length || common[(i + 1) * width + j]! >= common[i * width + j + 1]!)) {
      ops.push(['-', a[i]!])
      i++
    } else {
      ops.push(['+', b[j]!])
      j++
    }
  }
  return ops
}

function hunksOf(ops: Op[]): DiffHunk[] {
  const changed = ops.flatMap(([kind], index) => (kind === ' ' ? [] : [index]))
  if (changed.length === 0) return []
  const ranges: [number, number][] = []
  for (const index of changed) {
    const from = Math.max(0, index - CONTEXT)
    const to = Math.min(ops.length - 1, index + CONTEXT)
    const last = ranges.at(-1)
    if (last !== undefined && from <= last[1] + 1) last[1] = to
    else ranges.push([from, to])
  }
  const oldAt: number[] = []
  const newAt: number[] = []
  let oldLine = 1
  let newLine = 1
  for (const [kind] of ops) {
    oldAt.push(oldLine)
    newAt.push(newLine)
    if (kind !== '+') oldLine++
    if (kind !== '-') newLine++
  }
  return ranges.map(([from, to]) => ({
    oldStart: oldAt[from]!,
    newStart: newAt[from]!,
    lines: ops.slice(from, to + 1).map(([kind, text]) => kind + text),
  }))
}
