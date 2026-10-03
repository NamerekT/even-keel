import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { readLines } from '../../src/sessions/lines.js'
import { BatchBuilder, type Batch, type ParseContext } from './parse.js'

const HEAD_BYTES = 1024

export interface Source {
  path: string
  account: string
}

export interface FileState extends Source {
  offset: number
  size: number
  mtime: string
  ino: string
  head: string
  headLen: number
}

export interface Store {
  files(): Promise<Map<string, FileState>>
  write(batch: Batch, file: FileState): Promise<void>
}

export interface Current {
  size: number
  ino: string
  head: string
}

export function startOf(stored: FileState | undefined, current: Current): number | null {
  if (stored === undefined) return 0
  if (current.ino !== stored.ino || current.head !== stored.head || current.size < stored.offset) return 0
  return current.size === stored.offset ? null : stored.offset
}

export async function loadFile(
  source: Source,
  stored: FileState | undefined,
  store: Store,
  context: ParseContext,
  chunkBytes: number,
): Promise<number> {
  const info = await stat(source.path, { bigint: true })
  const size = Number(info.size)
  const ino = info.ino.toString()
  const mtime = info.mtime.toISOString()
  if (stored !== undefined && stored.size === size && stored.mtime === mtime && stored.ino === ino) return 0

  const head = stored === undefined ? '' : await headOf(source.path, stored.headLen)
  const from = startOf(stored, { size, ino, head })
  if (from === null) return 0
  const headLen = Math.min(HEAD_BYTES, size)
  const state = { ...source, size, mtime, ino, head: await headOf(source.path, headLen), headLen }

  let offset = from
  let chunk = chunkBytes
  let lines = 0
  while (offset < size) {
    const end = Math.min(size, offset + chunk)
    const read = await readLines(source.path, offset, end)
    if (read.next === offset) {
      if (end === size) break
      chunk *= 2
      continue
    }
    const builder = new BatchBuilder(context)
    for (const text of read.lines) builder.push(text)
    await store.write(builder.batch, { ...state, offset: read.next })
    lines += read.lines.length
    offset = read.next
    chunk = chunkBytes
  }
  return lines
}

async function headOf(file: string, length: number): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return createHash('sha1').update(buffer.subarray(0, bytesRead)).digest('hex')
  } finally {
    await handle.close()
  }
}
