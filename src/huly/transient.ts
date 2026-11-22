/**
 * A refusal of Huly that passes by itself and is worth asking again (BTN-1460, `ImportSource.transient`): its SQL
 * server's shared memory pool full at the moment ("memory budget exceeded", seen on a plan's read), a closed connection,
 * the network, and the storage's 429 and 5xx. The storage client keeps no HTTP status, only the answer's text, so a
 * `StorageError` is known by its words. Anything else — no access, a bad query, a file that is no more — stops at once.
 */
export function hulyTransient(error: unknown): boolean {
  for (let each = error, depth = 0; each instanceof Error && depth < 10; each = each.cause, depth += 1) {
    if (transientOne(each)) return true
  }
  return false
}

const PLATFORM_TRANSIENT = new Set(['platform:status:ConnectionClosed'])
const MESSAGE = /memory budget exceeded|socket hang up|fetch failed|\bECONN(RESET|REFUSED|ABORTED)\b|\bETIMEDOUT\b|\bEPIPE\b|\bEAI_AGAIN\b/i
const STORAGE = /^\s*(429|5\d\d)\b|\b(429|5\d\d) [A-Z]|too many requests|bad gateway|service unavailable|gateway time-?out|internal server error/i
const CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'])

function transientOne(error: Error): boolean {
  const { status, code } = error as { status?: unknown; code?: unknown }
  if (typeof status === 'number') return status === 429 || status >= 500
  const platform = typeof status === 'object' && status !== null ? (status as { code?: unknown }).code : undefined
  if (typeof platform === 'string' && PLATFORM_TRANSIENT.has(platform)) return true
  if (typeof code === 'string' && CODES.has(code)) return true
  if (error.name === 'NetworkError') return true
  if (error.name === 'StorageError' && STORAGE.test(error.message)) return true
  return MESSAGE.test(error.message)
}
