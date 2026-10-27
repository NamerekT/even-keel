import { open } from 'node:fs/promises'
import type { TurnError } from './cli.js'

const CHUNK_BYTES = 64 * 1024

interface Cursor {
  offset: number
  pending: Buffer
  oversized: boolean
  errors: Map<string, TurnError>
  reading?: Promise<void>
}

/** The account log is shared by turns; keep a byte cursor and the latest error per session, never the whole log. */
export class OpenCodeLog {
  private readonly files = new Map<string, Cursor>()

  async error(file: string, session: string, since: number): Promise<TurnError | undefined> {
    let cursor = this.files.get(file)
    if (cursor === undefined) {
      cursor = { offset: 0, pending: Buffer.alloc(0), oversized: false, errors: new Map() }
      this.files.set(file, cursor)
    }
    if (cursor.reading === undefined) {
      cursor.reading = this.read(file, cursor).finally(() => { cursor.reading = undefined })
    }
    await cursor.reading
    const found = cursor.errors.get(session)
    return found !== undefined && found.at > since ? found : undefined
  }

  private async read(file: string, cursor: Cursor): Promise<void> {
    const fd = await open(file, 'r').catch(() => undefined)
    if (fd === undefined) return
    try {
      const { size } = await fd.stat()
      if (size < cursor.offset) {
        cursor.offset = 0
        cursor.pending = Buffer.alloc(0)
        cursor.oversized = false
        cursor.errors.clear()
      }
      while (cursor.offset < size) {
        const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, size - cursor.offset))
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, cursor.offset)
        if (bytesRead === 0) break
        cursor.offset += bytesRead
        const joined = Buffer.concat([cursor.pending, buffer.subarray(0, bytesRead)])
        let start = 0
        for (let end = joined.indexOf(10); end !== -1; end = joined.indexOf(10, start)) {
          if (!cursor.oversized) {
            const parsed = parseLine(joined.subarray(start, end).toString('utf8'))
            if (parsed !== undefined) cursor.errors.set(parsed.session, parsed.error)
          }
          cursor.oversized = false
          start = end + 1
        }
        cursor.pending = joined.subarray(start)
        if (cursor.pending.length > CHUNK_BYTES) {
          cursor.pending = Buffer.alloc(0)
          cursor.oversized = true
        }
      }
    } catch {
      // A temporarily unavailable log does not make a live turn idle.
    } finally {
      await fd.close()
    }
  }
}

export function streamError(line: string, session: string, since: number): TurnError | undefined {
  const parsed = parseLine(line)
  return parsed?.session === session && parsed.error.at > since ? parsed.error : undefined
}

function parseLine(line: string): { session: string; error: TurnError } | undefined {
  const fields = new Map<string, string>()
  for (const match of line.matchAll(/([\w.]+)=("(?:\\.|[^"\\])*"|[^\s]+)/g)) {
    try {
      fields.set(match[1]!, match[2]!.startsWith('"') ? JSON.parse(match[2]!) as string : match[2]!)
    } catch { return undefined }
  }
  const prefix = /^(ERROR|\w+)\s+(\d{4}-\d\d-\d\dT[\d:.]+Z?)/.exec(line)
  if ((fields.get('level') ?? prefix?.[1]) !== 'ERROR' || fields.get('message') !== 'stream error') return undefined
  const time = fields.get('time') ?? fields.get('timestamp') ?? prefix?.[2]
  const at = time === undefined ? NaN : Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(time) ? time : `${time}Z`)
  const session = fields.get('session.id')
  const message = fields.get('error.error') ?? fields.get('error')
  if (!Number.isFinite(at) || session === undefined || message === undefined) return undefined
  return { session, error: { at, error: { name: 'StreamError', data: { message } } } }
}
