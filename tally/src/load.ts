import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { readLines } from '../../src/sessions/lines.js'
import { BatchBuilder, emptyBatch, type Batch, type ParseContext } from './parse.js'

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

  return readChunks(source.path, from, size, chunkBytes, context, (batch, next) => store.write(batch, { ...state, offset: next }))
}

// Re-reads a whole transcript for rule rows only (the backfill of rule versions), without touching its read state.
export async function loadRules(path: string, write: (batch: Batch) => Promise<void>, context: ParseContext, chunkBytes: number): Promise<number> {
  const { size } = await stat(path)
  return readChunks(path, 0, size, chunkBytes, { ...context, rulesOnly: true }, (batch) => write(batch))
}

async function readChunks(
  path: string,
  from: number,
  size: number,
  chunkBytes: number,
  context: ParseContext,
  write: (batch: Batch, next: number) => Promise<void>,
): Promise<number> {
  const builder = new BatchBuilder(context)
  let offset = from
  let chunk = chunkBytes
  let lines = 0
  while (offset < size) {
    const end = Math.min(size, offset + chunk)
    const read = await readLines(path, offset, end)
    if (read.next === offset) {
      if (end === size) break
      chunk *= 2
      continue
    }
    builder.batch = emptyBatch()
    for (const text of read.lines) builder.push(text)
    await write(builder.batch, read.next)
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
