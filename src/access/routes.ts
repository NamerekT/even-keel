import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { AUTH_PREFIX, deviceCookie, hostnameOf, SIGNED_OUT_COOKIE, type Visitor } from '../guard.js'
import { englishOf, fail, noticeOf } from '../notice/notice.js'
import { readJsonBody, sendJson } from '../server-response.js'
import type { AccessBook } from './book.js'
import { deviceNameOf } from './device-name.js'
import type { PasskeyDesk } from './passkeys.js'
import { keyMarkOf } from './store.js'
import type { AuthState, DevicesView } from './view.js'

const BODY_BYTES = 64 * 1024

/** The page's sign-in (BTN-1619, `docs/web/sign-in.md`). */
export interface AccessControl {
  book: AccessBook
  passkeys: PasskeyDesk
  /** The owner key as it is now; `null` — none set. */
  key(): string | null
}

interface Call {
  access: AccessControl
  request: IncomingMessage
  response: ServerResponse
  visitor: Visitor
  /** The RP ID: the name the page was opened by. */
  host: string
}

type Handler = (call: Call) => Promise<void>

/** Open to a visitor: what a browser needs to sign in. */
const OPEN: Record<string, Handler> = {
  'GET state': async ({ access, response, visitor, host }) => {
    const passkeyHere = (await access.passkeys.list()).some((passkey) => passkey.host === host)
    const state: AuthState = { signedIn: visitor.signedIn, keySet: access.key() !== null, passkeyHere, device: visitor.device?.device ?? null }
    sendJson(response, 200, state)
  },
  'POST key': async (call) => {
    const key = call.access.key()
    if (key === null) throw fail('auth.noKey', {})
    const offered = (await body(call.request)).key
    if (typeof offered !== 'string' || !same(offered.trim(), key)) throw fail('auth.wrongKey', {})
    await signIn(call, keyMarkOf(key))
  },
  'POST passkey/options': async ({ access, response, host }) => {
    sendJson(response, 200, await access.passkeys.authenticationOptions(host))
  },
  'POST passkey': async (call) => {
    const response = (await body(call.request)).response as AuthenticationResponseJSON
    const passkey = await call.access.passkeys.authenticate({ host: call.host, origin: originOf(call.request), response })
    await signIn(call, null, passkey.host)
  },
}

/** Only for a browser signed in already. */
const SIGNED_IN: Record<string, Handler> = {
  'POST passkey/register/options': async ({ access, response, host }) => {
    sendJson(response, 200, await access.passkeys.registrationOptions(host))
  },
  'POST passkey/register': async ({ access, request, response, host }) => {
    const answer = (await body(request)).response as RegistrationResponseJSON
    const passkey = await access.passkeys.register({ host, origin: originOf(request), response: answer, name: deviceNameOf(request.headers['user-agent']) })
    sendJson(response, 200, { id: passkey.credentialId })
  },
  'POST passkey/remove': async ({ access, request, response }) => {
    const id = (await body(request)).id
    sendJson(response, 200, { removed: typeof id === 'string' && (await access.passkeys.remove(id)) })
  },
  // A POST as the page's other queries are (`LiveSource.query`).
  'POST devices': async ({ access, response, visitor }) => {
    sendJson(response, 200, await devicesOf(access, visitor))
  },
  'POST devices/revoke': async ({ access, request, response }) => {
    const id = (await body(request)).id
    if (typeof id !== 'string' || !(await access.book.revoke(id))) throw fail('auth.deviceUnknown', {})
    sendJson(response, 200, { ok: true })
  },
  'POST devices/revoke-others': async ({ access, response, visitor }) => {
    const keep = visitor.device?.id
    const count = keep === undefined ? 0 : await access.book.revokeOthers(keep)
    sendJson(response, 200, { revoked: count })
  },
  'POST sign-out': async ({ access, response, visitor }) => {
    if (visitor.device !== undefined) await access.book.revoke(visitor.device.id)
    response.setHeader('set-cookie', SIGNED_OUT_COOKIE)
    sendJson(response, 200, { ok: true })
  },
}

/** Answers `/api/auth/*`; `false` — not a sign-in route. */
export async function accessRoute(access: AccessControl | undefined, request: IncomingMessage, response: ServerResponse, visitor: Visitor): Promise<boolean> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  if (!path.startsWith(AUTH_PREFIX)) return false
  const name = `${request.method} ${path.slice(AUTH_PREFIX.length)}`
  const open = OPEN[name]
  const handler = open ?? SIGNED_IN[name]
  if (access === undefined || handler === undefined) {
    response.writeHead(404, { 'cache-control': 'no-store' }).end()
    return true
  }
  try {
    if (open === undefined && !visitor.signedIn) {
      const notice = noticeOf(fail('auth.signInFirst', {}))
      sendJson(response, 401, { error: englishOf(notice), notice })
      return true
    }
    await handler({ access, request, response, visitor, host: hostnameOf(request.headers.host) ?? '' })
  } catch (error) {
    const notice = noticeOf(error)
    sendJson(response, 400, { error: englishOf(notice), notice })
  }
  return true
}

/** A new token for this browser, in its cookie; a sign-in it had before goes. */
async function signIn({ access, request, response, visitor }: Call, keyMark: string | null, passkeyHost: string | null = null): Promise<void> {
  const { token, secret } = await access.book.signIn({ device: deviceNameOf(request.headers['user-agent']), address: visitor.address, keyMark, passkeyHost })
  if (visitor.device !== undefined) await access.book.revoke(visitor.device.id)
  response.setHeader('set-cookie', deviceCookie(secret))
  sendJson(response, 200, { device: token.device })
}

async function devicesOf(access: AccessControl, visitor: Visitor): Promise<DevicesView> {
  const passkeys = (await access.passkeys.list()).map((passkey) => ({
    id: passkey.credentialId,
    name: passkey.name,
    host: passkey.host,
    createdAt: passkey.createdAt,
    usedAt: passkey.usedAt,
  }))
  const devices = access.book.devices().map((token) => ({
    id: token.id,
    device: token.device,
    createdAt: token.createdAt,
    seenAt: token.seenAt,
    seenFrom: token.seenFrom,
    byKey: token.keyMark !== null,
    passkeyHost: token.passkeyHost,
  }))
  return { passkeys, devices, current: visitor.device?.id ?? null, keySet: access.key() !== null }
}

function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  return readJsonBody(request, BODY_BYTES)
}

/** The page's origin a ceremony is bound to: the browser sends it with every `fetch` POST. */
function originOf(request: IncomingMessage): string {
  const origin = request.headers.origin
  if (origin === undefined) throw fail('auth.passkeyRefused', {})
  return origin
}

function same(offered: string, key: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest()
  return timingSafeEqual(digest(offered), digest(key))
}
