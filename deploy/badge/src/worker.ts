import { renderBadge } from 'even-keel-badge'
import { parseBadgeState } from './state.js'

/** The part of a KV namespace the Worker uses. */
export interface BadgeStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

export interface Env {
  BADGE: BadgeStore
  /** `wrangler secret put BADGE_SECRET`; without it every push is refused. */
  BADGE_SECRET?: string
}

/** The same rule as the service's `badge.slug`. */
const SLUG = '[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?'
const PUSH = new RegExp(`^/push/(${SLUG})$`)
const IMAGE = new RegExp(`^/(${SLUG})\\.svg$`)
/** A state is a few KB; anything far bigger is no state. */
const MAX_BODY = 64 * 1024
const NO_CACHE = 'no-cache, max-age=0'

/**
 * The README badge's Worker (BTN-916): `POST /push/<slug>` stores the state the service pushes, `GET /<slug>.svg` draws
 * it with the request's time, so the age, the grey dot and OFFLINE are counted when the picture is shown. KV is written
 * only by a push; the Worker calls nothing else.
 */
export async function handle(request: Request, env: Env, now: Date): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url)
  const push = PUSH.exec(pathname)
  if (push !== null && request.method === 'POST') return store(request, env, push[1]!)
  const image = IMAGE.exec(pathname)
  if (image !== null && request.method === 'GET') return draw(request, env, image[1]!, searchParams.get('theme') === 'light' ? 'light' : 'dark', now)
  return new Response('Not found', { status: 404 })
}

async function store(request: Request, env: Env, slug: string): Promise<Response> {
  if (!(await authorized(request.headers.get('authorization'), env.BADGE_SECRET))) return new Response('Unauthorized', { status: 401 })
  const body = await request.text()
  const state = new TextEncoder().encode(body).length > MAX_BODY ? null : parseBadgeState(body)
  if (state === null) return new Response('Not a badge state of version 1', { status: 400 })
  await env.BADGE.put(slug, JSON.stringify(state))
  return new Response(null, { status: 204 })
}

async function draw(request: Request, env: Env, slug: string, theme: 'dark' | 'light', now: Date): Promise<Response> {
  const stored = await env.BADGE.get(slug)
  const svg = renderBadge(stored === null ? null : parseBadgeState(stored), { theme, now })
  const etag = `"${await sha256(svg)}"`
  const headers = { 'cache-control': NO_CACHE, etag }
  if (matches(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers })
  return new Response(svg, { headers: { ...headers, 'content-type': 'image/svg+xml; charset=utf-8' } })
}

async function authorized(header: string | null, secret: string | undefined): Promise<boolean> {
  if (secret === undefined || secret === '' || header === null || !header.startsWith('Bearer ')) return false
  const [given, expected] = await Promise.all([sha256(header.slice('Bearer '.length)), sha256(secret)])
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) difference |= given.charCodeAt(index) ^ expected.charCodeAt(index)
  return difference === 0
}

function matches(header: string | null, etag: string): boolean {
  if (header === null) return false
  return header.split(',').some((tag) => {
    const value = tag.trim()
    return value === '*' || value === etag || value === `W/${etag}`
  })
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env, new Date()),
}
