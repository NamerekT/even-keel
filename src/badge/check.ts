import { notice, type Notice } from '../notice/notice.js'
import type { BadgeState } from './model.js'
import { isBadgeSlug, isHttp } from './settings.js'

const TIMEOUT_MS = 10_000

export interface BadgeCheckDeps {
  secret: string | undefined
  /** The project's state to push; the check is a real push. */
  state: BadgeState
  now: () => number
  post: (url: string, secret: string, body: string) => Promise<{ ok: boolean; status: number }>
  get: (url: string) => Promise<{ status: number; type: string }>
}

export interface BadgeCheck {
  ok: boolean
  notice: Notice
  /** The network error under `badge.unreachable`, for the log: a person reads only the notice. */
  cause?: string
}

/**
 * The badge dialog's "Check" (BTN-917): a push of the project's state to the Worker, then a read of its picture, so
 * the answer says which of the address, the secret and the Worker's version is wrong.
 */
export async function checkBadge(target: { url: string; slug: string }, deps: BadgeCheckDeps): Promise<BadgeCheck> {
  const url = target.url.trim().replace(/\/+$/, '')
  const slug = target.slug.trim()
  if (!isHttp(url)) return failed(notice('badge.url', {}))
  if (!isBadgeSlug(slug)) return failed(notice('badge.slug', {}))
  const secret = deps.secret?.trim()
  if (secret === undefined || secret === '') return failed(notice('badge.noSecret', {}))
  try {
    const answer = await deps.post(`${url}/push/${encodeURIComponent(slug)}`, secret, JSON.stringify({ ...deps.state, at: new Date(deps.now()).toISOString() }))
    if (!answer.ok) return failed(pushRefusal(answer.status))
  } catch (error) {
    return unreachable(error)
  }
  try {
    const picture = await deps.get(`${url}/${encodeURIComponent(slug)}.svg?theme=dark`)
    if (picture.status !== 200) return failed(notice('badge.imageStatus', { status: picture.status }))
    if (!picture.type.includes('svg')) return failed(notice('badge.notSvg', {}))
  } catch (error) {
    return unreachable(error)
  }
  return { ok: true, notice: notice('badge.checked', {}) }
}

function pushRefusal(status: number): Notice {
  if (status === 401) return notice('badge.refused', {})
  if (status === 404) return notice('badge.notWorker', {})
  if (status === 400) return notice('badge.rejected', {})
  return notice('badge.pushStatus', { status })
}

const failed = (reason: Notice): BadgeCheck => ({ ok: false, notice: reason })

/** `fetch` throws "fetch failed" and puts the reason (DNS, refused, TLS) in `cause`. */
function unreachable(error: unknown): BadgeCheck {
  const messages: string[] = []
  for (let each = error; each instanceof Error && messages.length < 3; each = each.cause) messages.push(each.message)
  return { ok: false, notice: notice('badge.unreachable', {}), cause: messages.join(': ') }
}

/** `fetch` of the picture with a timeout: the service's `get`. */
export async function getBadge(url: string): Promise<{ status: number; type: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  await response.body?.cancel()
  return { status: response.status, type: response.headers.get('content-type') ?? '' }
}
