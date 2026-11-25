import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { AUTH_PREFIX, deviceCookie, hostnameOf, isLoopbackHost, SIGNED_OUT_COOKIE, type Visitor } from '../guard.js'
import { englishOf, fail, noticeOf } from '../notice/notice.js'
import { readJsonBody, sendJson } from '../server-response.js'
import type { AccessBook } from './book.js'
import { deviceNameOf } from './device-name.js'
import { INVITE_MS, type InviteDesk, type JoinAnswer } from './invites.js'
import type { PageOrigins } from './origins.js'
import type { PasskeyDesk } from './passkeys.js'
import type { RateLimit } from './rate.js'
import { keyMarkOf } from './store.js'
import type { AuthState, DevicesView, InviteMade } from './view.js'

const BODY_BYTES = 64 * 1024
/** The cookie a new device keeps its claim on an invitation in: only the invitation's routes get it. */
export const INVITE_COOKIE = 'even-keel-invite'
const INVITE_PATH = '/api/auth/invite/'
/** How many calls of the invitation's open routes one address makes a minute (`RateLimit`). */
export const INVITE_CALLS = 30

/** The page's sign-in (BTN-1619, `docs/web/sign-in.md`). */
export interface AccessControl {
  book: AccessBook
  passkeys: PasskeyDesk
  /** The invitations of new devices (BTN-1655). */
  invites: InviteDesk
  /** The open invitation routes, by the caller's address. */
  inviteRate: RateLimit
  /** The page's outside addresses an invitation links to (BTN-1661). */
  origins: PageOrigins
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
    const keySet = access.key() !== null
    const unasked = visitor.signedIn && visitor.device === undefined && !keySet && !access.book.signInOn() && !isLoopbackHost(host)
    const state: AuthState = { signedIn: visitor.signedIn, keySet, passkeyHere, device: visitor.device?.device ?? null, takesInvite: !visitor.signedIn || unasked }
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
  // The new device's door (BTN-1655): no sign-in, so a rate limit and one answer for a wrong or an expired link.
  'POST invite/open': async (call) => {
    if (!slowed(call)) {
      const link = (await body(call.request)).link
      const entry = { device: deviceNameOf(call.request.headers['user-agent']), address: call.visitor.address }
      const answer = typeof link === 'string' && link !== '' ? await call.access.invites.open(link, claimOf(call.request), entry) : { view: { state: 'gone' as const } }
      await sendJoin(call, answer)
    }
  },
  'POST invite/wait': async (call) => {
    if (!slowed(call)) await sendJoin(call, await call.access.invites.wait(claimOf(call.request), call.visitor.address))
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
  'POST invites/create': async ({ access, response, visitor }) => {
    const made: InviteMade = { ...(await access.invites.create(visitor.device?.id ?? null)), origins: access.origins.list() }
    sendJson(response, 200, made)
  },
  // An address typed in the dialog of a page opened by `localhost` (BTN-1661): never checked from the hub, which in
  // Docker may not see its own proxy name; a wrong one shows at once, the phone does not open it.
  'POST invites/origin': async ({ access, request, response }) => {
    const typed = (await body(request)).origin
    const origin = await access.origins.remember(typeof typed === 'string' ? typed : '')
    sendJson(response, 200, { origin, origins: access.origins.list() })
  },
  'POST invites/admit': async ({ access, request, response, visitor, host }) => {
    const turned = await access.invites.admit(await idOf(request))
    // A hub without the key that asked nobody asks from now: the browser that let the device in, by a proxy's name, stays in.
    if (turned && access.key() === null && visitor.device === undefined && !isLoopbackHost(host)) {
      const { secret } = await access.book.signIn({ device: deviceNameOf(request.headers['user-agent']), address: visitor.address, keyMark: null })
      response.setHeader('set-cookie', deviceCookie(secret))
    }
    sendJson(response, 200, { ok: true })
  },
  'POST sign-in/off': async ({ access, response }) => {
    if (access.key() !== null) throw fail('auth.signInKeepsKey', {})
    await access.invites.signInOff()
    response.setHeader('set-cookie', SIGNED_OUT_COOKIE)
    sendJson(response, 200, { ok: true })
  },
  'POST invites/decline': async ({ access, request, response }) => {
    await access.invites.decline(await idOf(request))
    sendJson(response, 200, { ok: true })
  },
  'POST invites/cancel': async ({ access, request, response }) => {
    await access.invites.cancel(await idOf(request))
    sendJson(response, 200, { ok: true })
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
    byInvite: token.inviteId !== null,
  }))
  return { passkeys, devices, invites: await access.invites.live(), current: visitor.device?.id ?? null, keySet: access.key() !== null, signInOn: access.book.signInOn() }
}

/** Over the rate limit: answered 429 here. */
function slowed({ access, response, visitor }: Call): boolean {
  if (access.inviteRate.take(visitor.address)) return false
  const notice = noticeOf(fail('auth.inviteSlowDown', {}))
  sendJson(response, 429, { error: englishOf(notice), notice })
  return true
}

/** The new device's view; its claim and, once let in, its token go into cookies it cannot read. */
async function sendJoin(call: Call, answer: JoinAnswer): Promise<void> {
  const cookies: string[] = []
  if (answer.claim !== undefined) cookies.push(`${INVITE_COOKIE}=${answer.claim}; Path=${INVITE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${(INVITE_MS / 1000) * 2}`)
  if (answer.signedIn !== undefined) {
    if (call.visitor.device !== undefined) await call.access.book.revoke(call.visitor.device.id)
    cookies.push(deviceCookie(answer.signedIn.secret), `${INVITE_COOKIE}=; Path=${INVITE_PATH}; HttpOnly; SameSite=Strict; Max-Age=0`)
  }
  if (cookies.length > 0) call.response.setHeader('set-cookie', cookies)
  sendJson(call.response, 200, answer.view)
}

function claimOf(request: IncomingMessage): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === INVITE_COOKIE && value.join('=') !== '') return value.join('=')
  }
  return undefined
}

async function idOf(request: IncomingMessage): Promise<string> {
  const id = (await body(request)).id
  if (typeof id !== 'string') throw fail('auth.inviteGone', {})
  return id
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
