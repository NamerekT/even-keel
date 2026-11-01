import { open } from 'node:fs/promises'
import { setImmediate as yieldLoop } from 'node:timers/promises'

const NEWLINE = 0x0a
const CHUNK = 1024 * 1024

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

/**
 * The complete lines of `file` between `from` and `to`, a chunk at a time, giving the event loop a turn between
 * slices: a transcript caught up after a restart is many megabytes, and splitting and folding it at once held the
 * loop for seconds (BTN-690). A line still without its newline stays for the next read.
 */
export async function* lineSlices(file: string, from: number, to: number, chunk = CHUNK): AsyncGenerator<LineSlice> {
  if (to <= from) return
  const handle = await open(file, 'r')
  try {
    let pending: Buffer[] = []
    let position = from
    while (position < to) {
      const buffer = Buffer.allocUnsafe(Math.min(chunk, to - position))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) return
      const data = buffer.subarray(0, bytesRead)
      position += bytesRead
      const end = data.lastIndexOf(NEWLINE)
      if (end < 0) {
        pending.push(data)
        continue
      }
      const text = pending.length === 0 ? data.subarray(0, end) : Buffer.concat([...pending, data.subarray(0, end)])
      pending = end + 1 < data.length ? [data.subarray(end + 1)] : []
      yield { lines: text.toString('utf8').split('\n'), next: position - bytesRead + end + 1 }
      await yieldLoop()
    }
  } finally {
    await handle.close()
  }
}
