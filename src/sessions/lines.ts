import { open } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { setImmediate as yieldLoop } from 'node:timers/promises'

const NEWLINE = 0x0a
const CHUNK = 1024 * 1024
const GROUP = 64 * 1024

export interface LineSlice {
  lines: string[]
  /** The offset just past the slice's last line. */
  next: number
}

/** The complete lines of `file` between `from` and `to` at once; for the main thread `lineSlices`. */
export async function readLines(file: string, from: number, to: number): Promise<LineSlice> {
  if (to <= from) return { lines: [], next: from }
  const handle = await open(file, 'r')
  try {
    const chunk = Buffer.alloc(to - from)
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, from)
    const data = chunk.subarray(0, bytesRead)
    const end = data.lastIndexOf(NEWLINE)
    if (end < 0) return { lines: [], next: from }
    return { lines: data.subarray(0, end).toString('utf8').split('\n'), next: from + end + 1 }
  } finally {
    await handle.close()
  }
}

/** How long the readers together may hold one turn of the event loop. */
export const PACE_MS = 30

let turnStarted = performance.now()
let nextTurn: Promise<void> | undefined

/**
 * `undefined` while the readers have held the current turn of the event loop for less than `PACE_MS`; past it, a
 * promise of the next turn, the same one for every reader. A budget per reader would not do: the monitor reads
 * hundreds of transcripts at once, and their slices ran back to back in one turn for seconds.
 */
export function paced(): Promise<void> | undefined {
  if (performance.now() - turnStarted < PACE_MS) return undefined
  nextTurn ??= yieldLoop().then(() => {
    turnStarted = performance.now()
    nextTurn = undefined
  })
  return nextTurn
}

interface SliceSizes {
  /** Bytes read from the file at a time. */
  chunk?: number
  /** Bytes of lines given at a time, so that the reader's own work on them is paced too. */
  group?: number
}

/**
 * The complete lines of `file` between `from` and `to` in groups, each with the offset past its last line, waiting
 * for `paced` between them: a transcript caught up after a restart is many megabytes, and splitting and folding it at
 * once held the loop for seconds (BTN-690). A line still without its newline stays for the next read.
 */
export async function* lineSlices(file: string, from: number, to: number, sizes: SliceSizes = {}): AsyncGenerator<LineSlice> {
  if (to <= from) return
  const { chunk = CHUNK, group = GROUP } = sizes
  const handle = await open(file, 'r')
  try {
    let pending: Buffer[] = []
    let position = from
    while (position < to) {
      const buffer = Buffer.allocUnsafe(Math.min(chunk, to - position))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) return
      const data = buffer.subarray(0, bytesRead)
      const base = position
      position += bytesRead
      let lines: string[] = []
      let start = 0
      let groupStart = 0
      let end = data.indexOf(NEWLINE)
      while (end >= 0) {
        const piece = data.subarray(start, end)
        lines.push((pending.length === 0 ? piece : Buffer.concat([...pending, piece])).toString('utf8'))
        pending = []
        start = end + 1
        end = data.indexOf(NEWLINE, start)
        if (end < 0 || start - groupStart >= group) {
          yield { lines, next: base + start }
          lines = []
          groupStart = start
          const wait = paced()
          if (wait !== undefined) await wait
        }
      }
      if (start < data.length) pending.push(data.subarray(start))
    }
  } finally {
    await handle.close()
  }
}
