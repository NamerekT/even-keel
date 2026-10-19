import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** What a downloaded file was: its size and its digest, as hex and base64 (npm's `integrity` is base64). */
export interface Downloaded {
  bytes: number
  hex: string
  base64: string
}

/** A whole CLI is a few hundred megabytes. */
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000
const FETCH_TIMEOUT_MS = 60_000

export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

/** Streams `url` into `file`, hashing it on the way. */
export async function downloadFile(url: string, file: string, algorithm: 'sha256' | 'sha512'): Promise<Downloaded> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok || response.body === null) throw new Error(`${url}: HTTP ${response.status}`)
  const hash = createHash(algorithm)
  let bytes = 0
  const count = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      bytes += chunk.length
      done(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), count, createWriteStream(file))
  const digest = hash.digest()
  return { bytes, hex: digest.toString('hex'), base64: digest.toString('base64') }
}
