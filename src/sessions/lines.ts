import { open } from 'node:fs/promises'

const NEWLINE = 0x0a

export interface ReadLines {
  lines: string[]
  next: number
}

export async function readLines(file: string, from: number, to: number): Promise<ReadLines> {
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
