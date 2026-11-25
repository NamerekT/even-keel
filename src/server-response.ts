import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { constants, createGzip } from 'node:zlib'
import { englishOf, fail, noticeOf } from './notice/notice.js'
import type { TaskFile } from './tracker/source.js'
import { securePage } from './server-security.js'

/** Files the browser may show in place; anything else is a download, so a tracker file never runs as the page. */
const SHOWN_IN_PLACE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf)$/
const SVG = /^image\/svg\+xml\s*(;.*)?$/i
/** No script, no fetch, no form or frame — only the drawing's own inline styles (CSS `@keyframes` keep running). */
const SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox"


const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}


// `error` stays for scripts; the page translates `notice`.
export function sendFailure(response: ServerResponse, error: unknown): void {
  const notice = noticeOf(error)
  sendJson(response, 400, { error: englishOf(notice), notice })
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  const compressed = json !== undefined && Buffer.byteLength(json) >= 1024 && acceptsGzip(response)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    vary: 'Accept-Encoding',
    ...(compressed ? { 'content-encoding': 'gzip' } : {}),
  })
  if (!compressed) {
    response.end(json)
    return
  }
  void pipeline(Readable.from([json]), createGzip({ level: constants.Z_BEST_SPEED }), response).catch(() => response.destroy())
}

function acceptsGzip(response: ServerResponse): boolean {
  const accepted = new Map<string, number>()
  for (const entry of (response.req.headers['accept-encoding'] ?? '').split(',')) {
    const [name, ...parameters] = entry.trim().toLowerCase().split(';')
    const q = parameters.find((parameter) => parameter.trim().startsWith('q='))?.trim().slice(2)
    const quality = q === undefined ? 1 : Number(q)
    accepted.set(name!, Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0)
  }
  return (accepted.get('gzip') ?? accepted.get('*') ?? 0) > 0
}

export function eventWriter(response: ServerResponse): { write(frame: string): void; end(): void } {
  const compressed = acceptsGzip(response)
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    vary: 'Accept-Encoding',
    ...(compressed ? { 'content-encoding': 'gzip' } : {}),
  })
  response.flushHeaders()
  if (!compressed) return { write: (frame) => { response.write(frame) }, end: () => { response.end() } }
  const gzip = createGzip({ level: constants.Z_BEST_SPEED })
  gzip.on('error', () => response.destroy())
  response.once('close', () => gzip.destroy())
  gzip.pipe(response)
  return {
    write: (frame) => {
      if (gzip.destroyed || gzip.writableEnded) return
      gzip.write(frame)
      gzip.flush(constants.Z_SYNC_FLUSH)
    },
    end: () => { gzip.end() },
  }
}

/**
 * A file shown in place keeps the page's policy; an SVG gets one that runs no script even opened by its own address,
 * its inline styles and SMIL animation kept; anything else is a sandboxed download.
 *
 * A file of a known size answers a single `Range` with 206 and that piece (BTN-1704): Safari on iOS plays no `<video>`
 * without it, and Chrome cannot seek one. Several ranges get the whole file; a range past the end, 416.
 */
export async function sendFile(response: ServerResponse, file: TaskFile): Promise<void> {
  const drawing = SVG.test(file.type)
  const shown = drawing || SHOWN_IN_PLACE.test(file.type)
  const range = file.size === null ? null : rangeOf(response.req.headers.range, file.size)
  const headers = {
    'content-type': file.type || 'application/octet-stream',
    'content-disposition': `${shown ? 'inline' : 'attachment'}${file.name === undefined ? '' : `; filename*=UTF-8''${encodeURIComponent(file.name)}`}`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=3600',
    ...(file.size === null ? {} : { 'accept-ranges': 'bytes' }),
    ...(drawing ? { 'content-security-policy': SVG_POLICY } : shown ? {} : { 'content-security-policy': 'sandbox' }),
  }
  if (range === 'unsatisfiable') {
    if (file.body instanceof Readable) file.body.destroy()
    response.writeHead(416, { ...headers, 'content-range': `bytes */${file.size}`, 'content-length': '0' }).end()
    return
  }
  if (range === null) response.writeHead(200, { ...headers, ...(file.size === null ? {} : { 'content-length': String(file.size) }) })
  else response.writeHead(206, { ...headers, 'content-range': `bytes ${range.start}-${range.end}/${file.size}`, 'content-length': String(range.end - range.start + 1) })
  try {
    await pipeline(Readable.from(range === null ? file.body : slice(file.body, range.start, range.end)), response)
  } catch {
    response.destroy()
  }
}

/** The one byte range a `Range` header asks of a file of `size` bytes, both ends included; `null` — the whole file. */
export function rangeOf(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null
  const [, from, to] = match as unknown as [string, string, string]
  if (from === '' && to === '') return null
  if (from === '') {
    const last = Number(to)
    return last === 0 || size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - last), end: size - 1 }
  }
  const start = Number(from)
  if (start >= size) return 'unsatisfiable'
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1)
  return end < start ? null : { start, end }
}

async function* slice(body: AsyncIterable<Uint8Array>, start: number, end: number): AsyncGenerator<Uint8Array> {
  let at = 0
  for await (const chunk of body) {
    const from = Math.max(0, start - at)
    const to = Math.min(chunk.length, end + 1 - at)
    if (to > from) yield chunk.subarray(from, to)
    at += chunk.length
    if (at > end) return
  }
}

export async function readJsonBody(request: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw fail('request.tooLarge', { limit })
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw fail('request.notJson', {})
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw fail('request.notObject', {})
  return body as Record<string, unknown>
}

export async function serveStatic(publicDir: string, path: string, response: ServerResponse): Promise<void> {
  const root = normalize(publicDir + sep)
  const isClientRoute = !path.startsWith('/api/') && extname(path) === ''
  const file = normalize(join(root, isClientRoute ? 'index.html' : decodeURIComponent(path)))
  if (!file.startsWith(root)) {
    response.writeHead(404).end()
    return
  }
  let body: Buffer
  try {
    body = await readFile(file)
  } catch {
    if (isClientRoute) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('The web client is not built: run npm run build')
      return
    }
    response.writeHead(404).end()
    return
  }
  if (extname(file) === '.html') securePage(response)
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  response.end(body)
}
