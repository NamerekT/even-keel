import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AccessToken } from './access/store.js'
import { hookRouteOf } from './link/hooks.js'
import { fail } from './notice/notice.js'

/**
 * Who may reach the page: the `Host` check stops DNS rebinding, the `Origin` check stops other sites posting
 * to it, the token keeps the network out when the service listens beyond loopback.
 */
export interface GuardSettings {
  /** Lowercase host names without port or brackets. */
  hosts: ReadonlySet<string>
  /** The owner key (`EVEN_KEEL_TOKEN`); `null` — the service listens on loopback only and takes no key. */
  token: string | null
  /** The language of the form that asks for the token; English without it. */
  language?: 'en' | 'ru'
  /**
   * The devices signed in (BTN-1619, `docs/web/sign-in.md`); absent — the blocked service, where the cookie holds the
   * key itself and the form asks for it.
   */
  book?: DeviceBook
  /** The page's outside addresses (BTN-1661): every request let in notes its `Origin` (`src/access/origins.ts`). */
  origins?: { seen(origin: string | undefined): void }
}

/** The device tokens the guard checks a request against, held in memory (`src/access/book.ts`). */
export interface DeviceBook {
  /** The live token of this secret; a revoked or unknown one is `undefined`. */
  find(secret: string): AccessToken | undefined
  /** Notes the token was used now from this address. */
  seen(token: AccessToken, address: string): void
  /** Issues a device a token of its own; `keyMark` — signed in with the owner key. */
  signIn(entry: { device: string; address: string; keyMark: string | null }): Promise<{ token: AccessToken; secret: string }>
  /** An invitation turned the sign-in on (BTN-1656): without the key a proxy's name is asked as with it. */
  signInOn(): boolean
}

const TOKEN_FORM = {
  en: { title: 'Even Keel', ask: 'The page needs the access token: EVEN_KEEL_TOKEN in the .env of Even Keel.', open: 'Open' },
  ru: { title: 'Even Keel', ask: 'Странице нужен токен доступа: EVEN_KEEL_TOKEN в .env самого Even Keel.', open: 'Открыть' },
}

/** The page a browser gets without a valid token: a form that opens the same address with `?token=`. */
export function tokenForm(language: 'en' | 'ru' = 'en'): string {
  const text = TOKEN_FORM[language]
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text.title}</title>
<style>body{font:15px system-ui,sans-serif;background:#16181d;color:#e6e6e6;display:grid;place-items:center;min-height:100vh;margin:0}form{display:grid;gap:12px;max-width:360px;padding:24px}input,button{font:inherit;padding:8px 10px;border-radius:6px;border:1px solid #3a3f4b;background:#20232a;color:inherit}button{cursor:pointer}</style></head>
<body><form method="get"><p>${text.ask}</p><input name="token" type="password" autocomplete="current-password" required autofocus><button type="submit">${text.open}</button></form></body></html>`
}

export interface GuardRequest {
  method: string
  url: string
  host: string | undefined
  origin: string | undefined
  contentType: string | undefined
  cookie: string | undefined
  authorization: string | undefined
  /** Socket addresses; equal ones mean a connection from this machine to its own address. */
  remote: string | undefined
  local: string | undefined
}

export type GuardVerdict =
  /** `device` — the device token the request came with; none — this machine, the owner key or the OAuth callback. */
  | { kind: 'pass'; device?: AccessToken }
  /** Not signed in, with a book: only the page's files, to draw its sign-in screen, and the sign-in routes. */
  | { kind: 'visit' }
  | { kind: 'refuse'; status: 401 | 403 | 415; reason: string }
  /** The blocked service's first visit with `?token=`: set the cookie and send the browser to the address without it. */
  | { kind: 'enter'; location: string; cookie: string }
  /** An old link with the owner key in `?token=`: sign the device in with the key and send it to the address without it. */
  | { kind: 'signIn'; location: string }

/** Who the guard let in, for the routes: the sign-in routes and a device's event stream. */
export interface Visitor {
  /** `false` — a visit: the page's files and the sign-in routes only. */
  signedIn: boolean
  device: AccessToken | undefined
  /** Where the request came from: a proxy's on this machine is the first `X-Forwarded-For`. */
  address: string
}

export const TOKEN_COOKIE = 'even-keel-token'
export const OAUTH_CALLBACK_PATH = '/api/profiles/oauth/callback'
const ATTACH_PATH = '/api/builtin/attach'
export const AUTH_PREFIX = '/api/auth/'
const OAUTH_COOKIE = 'even-keel-oauth'
const OAUTH_SECONDS = 600
const TOKEN_SHAPE = /^[A-Za-z0-9._~+/=-]{16,}$/
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60
const PROCESS_SECRET = randomBytes(32)
const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '::1']
const WILDCARDS = ['0.0.0.0', '::']

export function guardHosts(host: string, allowed: readonly string[]): Set<string> {
  const hosts = new Set(LOOPBACK_NAMES)
  if (!WILDCARDS.includes(host)) hosts.add(bare(host))
  for (const name of allowed) hosts.add(bare(name))
  return hosts
}

export function isLoopbackHost(host: string): boolean {
  const name = bare(host)
  return name === 'localhost' || name === '::1' || /^127\.\d+\.\d+\.\d+$/.test(name)
}

/** The token from the environment; a host the network reaches cannot go without one. */
export function guardToken(env: NodeJS.ProcessEnv, host: string): string | null {
  const token = env.EVEN_KEEL_TOKEN?.trim() ?? ''
  if (token === '') {
    if (isLoopbackHost(host)) return null
    throw fail('config.token', { host })
  }
  if (!TOKEN_SHAPE.test(token)) throw fail('config.tokenShape', {})
  return token
}

export function guard(settings: GuardSettings, request: GuardRequest): GuardVerdict {
  const host = hostnameOf(request.host)
  if (host === undefined || !settings.hosts.has(host)) {
    return { kind: 'refuse', status: 403, reason: `host ${request.host ?? '(none)'} is not allowed; add it to allowedHosts` }
  }
  // The whole origin, port included: another app on an allowed name is another site (BTN-1080).
  if (request.origin !== undefined && !sameOrigin(request.origin, request.host!)) {
    return { kind: 'refuse', status: 403, reason: `origin ${request.origin} is not the page's own (${request.host})` }
  }
  const admitted = typeVerdict(request)
  const token = settings.token
  const book = settings.book
  // Without the key a hub asks nobody until an invitation let a device in (BTN-1656).
  const asks = token !== null || book?.signInOn() === true
  // A proxy on this machine sends its own name: only loopback names and the hooks go without a sign-in (BTN-1619).
  if (fromThisMachine(request) && (!asks || isLoopbackHost(host) || hookRouteOf(request.method, request.url) !== undefined)) return admitted
  if (!asks) return { kind: 'refuse', status: 401, reason: `${request.remote} is not on this machine and no token is set` }

  if (same(bearerOf(request.authorization), token)) return admitted
  if (book === undefined && same(cookieOf(request.cookie), token)) return admitted
  const device = book === undefined ? undefined : deviceOf(book, request)
  if (device !== undefined) return admitted.kind === 'pass' ? { kind: 'pass', device } : admitted

  const url = new URL(request.url, 'http://localhost')
  if (isOAuthCallback(request) && validOAuthCookie(request.cookie, token)) return { kind: 'pass' }
  const offered = url.searchParams.get('token')
  if (token !== null && request.method === 'GET' && offered !== null && same(offered, token)) {
    url.searchParams.delete('token')
    const location = url.pathname + url.search
    if (book !== undefined) return { kind: 'signIn', location }
    return { kind: 'enter', location, cookie: `${TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}` }
  }
  if (book !== undefined && ((request.method === 'GET' && !url.pathname.startsWith('/api/')) || url.pathname.startsWith(AUTH_PREFIX))) {
    return admitted.kind === 'pass' ? { kind: 'visit' } : admitted
  }
  return { kind: 'refuse', status: 401, reason: `${request.remote} came without a valid sign-in; sign in on the page` }
}

/** The cookie a signed-in device keeps its token's secret in. */
export function deviceCookie(secret: string): string {
  return `${TOKEN_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`
}

/** The cookie that drops it: signing out. */
export const SIGNED_OUT_COOKIE = `${TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`

function deviceOf(book: DeviceBook, request: GuardRequest): AccessToken | undefined {
  for (const secret of [cookieOf(request.cookie), bearerOf(request.authorization)]) {
    const device = secret === undefined || secret === '' ? undefined : book.find(secret)
    if (device !== undefined) return device
  }
  return undefined
}

export function isOAuthCallback(request: Pick<GuardRequest, 'method' | 'url'>): boolean {
  return request.method === 'GET' && request.url.split('?')[0] === OAUTH_CALLBACK_PATH
}

/** A short-lived credential with no authority outside the browser callback. */
export function oauthCallbackCookie(token: string | null): string {
  const expires = Date.now() + OAUTH_SECONDS * 1000
  return `${OAUTH_COOKIE}=${expires}.${oauthSignature(token, expires)}; Path=${OAUTH_CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_SECONDS}`
}

function validOAuthCookie(header: string | undefined, token: string | null): boolean {
  const [expiry, signature] = cookieOf(header, OAUTH_COOKIE)?.split('.') ?? []
  const expires = Number(expiry)
  return Number.isSafeInteger(expires) && expires > Date.now() && same(signature, oauthSignature(token, expires))
}

/** Signed with the key; a hub without one signs with a secret of this process, so a restart drops the cookie. */
function oauthSignature(token: string | null, expires: number): string {
  return createHmac('sha256', token ?? PROCESS_SECRET).update(`oauth-callback:${expires}`).digest('base64url')
}

function bare(host: string): string {
  return host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '')
}

/** The bare host name of a `Host` header: the passkeys' RP ID. */
export function hostnameOf(header: string | undefined): string | undefined {
  if (header === undefined || header === '' || /[/\\@?#\s]/.test(header)) return undefined
  try {
    return bare(new URL(`http://${header}`).hostname)
  } catch {
    return undefined
  }
}

/**
 * `Origin` names the same host and port as `Host`, the port read by the origin's scheme: an HTTPS proxy sends the
 * name without a port and the browser's origin is `https://name`.
 */
function sameOrigin(origin: string, host: string): boolean {
  try {
    const url = new URL(origin)
    return url.origin !== 'null' && new URL(`${url.protocol}//${host}`).host === url.host
  } catch {
    return false
  }
}

/**
 * A POST to the API only as JSON (BTN-1080): another type is a request a foreign page sends without a preflight.
 * An attached file's bytes come as their own type.
 */
function typeVerdict({ method, url, contentType }: GuardRequest): GuardVerdict {
  const path = url.split('?')[0]!
  if (method !== 'POST' || !path.startsWith('/api/') || path === ATTACH_PATH) return { kind: 'pass' }
  if (/^application\/json\s*(;|$)/i.test(contentType ?? '')) return { kind: 'pass' }
  return { kind: 'refuse', status: 415, reason: `POST ${path} came as ${contentType ?? '(no type)'}; the API takes application/json` }
}

function fromThisMachine({ remote, local }: Pick<GuardRequest, 'remote' | 'local'>): boolean {
  if (remote === undefined) return false
  const address = unmapped(remote)
  return address === '::1' || /^127\./.test(address) || (local !== undefined && address === unmapped(local))
}

/** A socket's address as a person reads it: an IPv4 one mapped into IPv6 (`::ffff:192.0.2.10`) as plain IPv4. */
export function unmapped(address: string): string {
  return address.replace(/^::ffff:(?=\d{1,3}(\.\d{1,3}){3}$)/i, '')
}

/**
 * The address a request came from, as the devices list shows it: behind a proxy on this machine the first
 * `X-Forwarded-For`; from elsewhere the socket's, which a header cannot fake.
 */
export function addressOf(request: Pick<GuardRequest, 'remote' | 'local'>, forwardedFor: string | undefined): string {
  const forwarded = forwardedFor?.split(',')[0]?.trim()
  if (fromThisMachine(request) && forwarded !== undefined && forwarded !== '') return forwarded.slice(0, 64)
  return unmapped(request.remote ?? '')
}

function cookieOf(header: string | undefined, cookieName = TOKEN_COOKIE): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [name, ...value] = part.trim().split('=')
    if (name === cookieName) return value.join('=')
  }
  return undefined
}

function bearerOf(header: string | undefined): string | undefined {
  return /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1]
}

function same(offered: string | undefined, token: string | null): boolean {
  if (offered === undefined || token === null) return false
  const digest = (text: string) => createHash('sha256').update(text).digest()
  return timingSafeEqual(digest(offered), digest(token))
}
