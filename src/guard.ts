import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { fail } from './notice/notice.js'

/**
 * Who may reach the page: the `Host` check stops DNS rebinding, the `Origin` check stops other sites posting
 * to it, the token keeps the network out when the service listens beyond loopback.
 */
export interface GuardSettings {
  /** Lowercase host names without port or brackets. */
  hosts: ReadonlySet<string>
  /** `null` — the service listens on loopback only and takes no token. */
  token: string | null
  /** The language of the form that asks for the token; English without it. */
  language?: 'en' | 'ru'
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
  cookie: string | undefined
  authorization: string | undefined
  /** Socket addresses; equal ones mean a connection from this machine to its own address. */
  remote: string | undefined
  local: string | undefined
}

export type GuardVerdict =
  | { kind: 'pass' }
  | { kind: 'refuse'; status: 401 | 403; reason: string }
  /** The first visit with `?token=`: set the cookie and send the browser to the address without it. */
  | { kind: 'enter'; location: string; cookie: string }

export const TOKEN_COOKIE = 'even-keel-token'
export const OAUTH_CALLBACK_PATH = '/api/profiles/oauth/callback'
const OAUTH_COOKIE = 'even-keel-oauth'
const OAUTH_SECONDS = 600
const TOKEN_SHAPE = /^[A-Za-z0-9._~+/=-]{16,}$/
const COOKIE_DAYS = 365
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
  if (request.origin !== undefined) {
    const origin = originHostOf(request.origin)
    if (origin === undefined || !settings.hosts.has(origin)) {
      return { kind: 'refuse', status: 403, reason: `origin ${request.origin} is not allowed` }
    }
  }
  if (fromThisMachine(request)) return { kind: 'pass' }

  const token = settings.token
  if (token === null) return { kind: 'refuse', status: 401, reason: `${request.remote} is not on this machine and no token is set` }
  if (same(cookieOf(request.cookie), token) || same(bearerOf(request.authorization), token)) return { kind: 'pass' }

  const url = new URL(request.url, 'http://localhost')
  if (isOAuthCallback(request) && validOAuthCookie(request.cookie, token)) return { kind: 'pass' }
  const offered = url.searchParams.get('token')
  if (request.method === 'GET' && offered !== null && same(offered, token)) {
    url.searchParams.delete('token')
    return {
      kind: 'enter',
      location: url.pathname + url.search,
      cookie: `${TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_DAYS * 24 * 60 * 60}`,
    }
  }
  return { kind: 'refuse', status: 401, reason: `${request.remote} came without a valid token; open the page once with ?token=` }
}

export function isOAuthCallback(request: Pick<GuardRequest, 'method' | 'url'>): boolean {
  return request.method === 'GET' && request.url.split('?')[0] === OAUTH_CALLBACK_PATH
}

/** A short-lived credential with no authority outside the browser callback. */
export function oauthCallbackCookie(token: string): string {
  const expires = Date.now() + OAUTH_SECONDS * 1000
  return `${OAUTH_COOKIE}=${expires}.${oauthSignature(token, expires)}; Path=${OAUTH_CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_SECONDS}`
}

function validOAuthCookie(header: string | undefined, token: string): boolean {
  const [expiry, signature] = cookieOf(header, OAUTH_COOKIE)?.split('.') ?? []
  const expires = Number(expiry)
  return Number.isSafeInteger(expires) && expires > Date.now() && same(signature, oauthSignature(token, expires))
}

function oauthSignature(token: string, expires: number): string {
  return createHmac('sha256', token).update(`oauth-callback:${expires}`).digest('base64url')
}

function bare(host: string): string {
  return host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '')
}

function hostnameOf(header: string | undefined): string | undefined {
  if (header === undefined || header === '' || /[/\\@?#\s]/.test(header)) return undefined
  try {
    return bare(new URL(`http://${header}`).hostname)
  } catch {
    return undefined
  }
}

function originHostOf(origin: string): string | undefined {
  try {
    const url = new URL(origin)
    return url.origin === 'null' ? undefined : bare(url.hostname)
  } catch {
    return undefined
  }
}

function fromThisMachine({ remote, local }: GuardRequest): boolean {
  if (remote === undefined) return false
  const address = unmapped(remote)
  return address === '::1' || /^127\./.test(address) || (local !== undefined && address === unmapped(local))
}

function unmapped(address: string): string {
  return address.replace(/^::ffff:/i, '')
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

function same(offered: string | undefined, token: string): boolean {
  if (offered === undefined) return false
  const digest = (text: string) => createHash('sha256').update(text).digest()
  return timingSafeEqual(digest(offered), digest(token))
}
