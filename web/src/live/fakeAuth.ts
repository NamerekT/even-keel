import { fail } from '../../../src/notice/notice.js'
import type { DevicesView, InviteView, JoinView } from '../../../src/access/view.js'

/** The owner key `dev:fake` takes on its sign-in screen (`/?signIn`); any other is wrong. */
export const FAKE_OWNER_KEY = 'owner-key'

const HOUR_MS = 60 * 60 * 1000
const INVITE_MS = 10 * 60 * 1000
/** How long the fake new device takes to open a link just made, and the fake hub to decide on a waiting one. */
const OPEN_MS = 3000

const deviceListeners = new Set<() => void>()

/** `LiveSource.onDevices` of `dev:fake`: called when a fake invitation is opened or decided. */
export function fakeDevicesChanged(listener: () => void): () => void {
  deviceListeners.add(listener)
  return () => deviceListeners.delete(listener)
}

function changed(): void {
  for (const listener of deviceListeners) listener()
}

/** `?invites` starts the settings with two invitations waiting: one unopened, one opened by a phone. */
function startInvites(now: number): InviteView[] {
  if (!new URLSearchParams(location.search).has('invites')) return []
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()
  return [
    { id: 'inv-unopened', createdAt: at(2), expiresAt: new Date(now + INVITE_MS - 2 * 60_000).toISOString(), opened: null },
    { id: 'inv-opened', createdAt: at(4), expiresAt: new Date(now + INVITE_MS - 4 * 60_000).toISOString(), opened: { device: 'Safari on iPhone', from: '100.64.0.21', at: at(1), digits: '47' } },
  ]
}

/**
 * "Sign-in and devices" of `dev:fake`: three passkeys on two names and four devices, this browser one of them;
 * `?signInOn` — an invitation turned the sign-in on already.
 */
function freshView(now: number): DevicesView {
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR_MS).toISOString()
  return {
    passkeys: [
      { id: 'pk-phone', name: 'Safari on iPhone', host: 'hub.example.ts.net', createdAt: at(30), usedAt: at(0.1) },
      { id: 'pk-office', name: 'Chrome on Windows', host: 'hub.example.ts.net', createdAt: at(28), usedAt: at(2) },
      { id: 'pk-local', name: 'Chrome on Windows', host: 'localhost', createdAt: at(26), usedAt: null },
    ],
    devices: [
      { id: 'dev-phone', device: 'Safari on iPhone', createdAt: at(30), seenAt: at(0), seenFrom: '100.64.0.12', byKey: false, passkeyHost: 'hub.example.ts.net', byInvite: false },
      { id: 'dev-office', device: 'Chrome on Windows', createdAt: at(28), seenAt: at(2), seenFrom: '100.64.0.7', byKey: true, passkeyHost: null, byInvite: false },
      { id: 'dev-local', device: 'Chrome on Windows', createdAt: at(26), seenAt: at(5), seenFrom: '172.17.0.1', byKey: false, passkeyHost: 'localhost', byInvite: false },
      { id: 'dev-tablet', device: 'Safari on iPad', createdAt: at(20), seenAt: at(8), seenFrom: '100.64.0.15', byKey: false, passkeyHost: null, byInvite: true },
    ],
    invites: startInvites(now),
    current: 'dev-phone',
    keySet: true,
    signInOn: new URLSearchParams(location.search).has('signInOn'),
  }
}

let view: DevicesView | null = null

/** Answers the `auth/*` queries of the settings group; `keySet` follows the fake `EVEN_KEEL_TOKEN` of the access settings. */
export function fakeAuthQuery(name: string, body: Record<string, unknown>, keySet: boolean, now = Date.now()): unknown {
  view ??= freshView(now)
  const current = view
  switch (name) {
    case 'auth/devices':
      return { ...current, keySet }
    case 'auth/passkey/remove':
      view = { ...current, passkeys: current.passkeys.filter((each) => each.id !== body.id) }
      return { removed: true }
    case 'auth/devices/revoke':
      if (!current.devices.some((each) => each.id === body.id)) throw fail('auth.deviceUnknown', {})
      view = { ...current, devices: current.devices.filter((each) => each.id !== body.id) }
      return { ok: true }
    case 'auth/devices/revoke-others':
      view = { ...current, devices: current.devices.filter((each) => each.id === current.current) }
      return { revoked: current.devices.length - view.devices.length }
    case 'auth/invites/create':
      return makeInvite(current, now)
    case 'auth/invites/admit': {
      const invite = current.invites.find((each) => each.id === body.id && each.opened !== null)
      if (invite?.opened == null) throw fail('auth.inviteGone', {})
      const device = { id: `dev-${now}`, device: invite.opened.device, createdAt: new Date(now).toISOString(), seenAt: null, seenFrom: invite.opened.from, byKey: false, passkeyHost: null, byInvite: true }
      view = { ...current, devices: [...current.devices, device], invites: current.invites.filter((each) => each !== invite), signInOn: true }
      changed()
      return { ok: true }
    }
    case 'auth/sign-in/off':
      if (keySet) throw fail('auth.signInKeepsKey', {})
      view = { ...current, devices: [], current: null, signInOn: false }
      return { ok: true }
    case 'auth/invites/decline':
    case 'auth/invites/cancel':
      if (!current.invites.some((each) => each.id === body.id)) throw fail('auth.inviteGone', {})
      view = { ...current, invites: current.invites.filter((each) => each.id !== body.id) }
      changed()
      return { ok: true }
    default:
      return fakeSignInPost(name, body, now)
  }
}

/** A new invitation; a fake phone opens it `OPEN_MS` later, with the digits 47. */
function makeInvite(current: DevicesView, now: number): unknown {
  if (current.invites.length >= 5) throw fail('auth.invitesFull', { count: current.invites.length })
  const id = `inv-${now}`
  const expiresAt = new Date(now + INVITE_MS).toISOString()
  view = { ...current, invites: [...current.invites, { id, createdAt: new Date(now).toISOString(), expiresAt, opened: null }] }
  setTimeout(() => {
    if (view === null || !view.invites.some((each) => each.id === id)) return
    const opened = { device: 'Safari on iPhone', from: '100.64.0.21', at: new Date().toISOString(), digits: '47' }
    view = { ...view, invites: view.invites.map((each) => (each.id === id ? { ...each, opened } : each)) }
    changed()
  }, OPEN_MS)
  return { id, secret: 'fake-invite-secret', expiresAt }
}

/**
 * The new device's side at `/invite?signIn`: `?invite=` picks the outcome (`declined`, `expired`, `cancelled`, `waiting`
 * for good, `used` and `gone` at once); without it the hub lets the device in `OPEN_MS` after it opened the link.
 */
function fakeJoin(name: string, now: number): JoinView | Promise<JoinView> {
  const outcome = new URLSearchParams(location.search).get('invite')
  if (name === 'auth/invite/open') {
    if (outcome === 'used' || outcome === 'gone') return { state: outcome }
    return { state: 'waiting', digits: '47', expiresAt: new Date(now + INVITE_MS).toISOString() }
  }
  const after: JoinView =
    outcome === 'declined' || outcome === 'expired' || outcome === 'cancelled'
      ? { state: outcome }
      : outcome === 'waiting'
        ? { state: 'waiting', digits: '47', expiresAt: new Date(now + INVITE_MS).toISOString() }
        : { state: 'admitted', device: 'Safari on iPhone' }
  return new Promise((resolve) => setTimeout(() => resolve(after), OPEN_MS))
}

/** The sign-in calls of `dev:fake`: a passkey always passes (the browser's dialog is skipped), the key only if it is `FAKE_OWNER_KEY`. */
export function fakeSignInPost(name: string, body: Record<string, unknown>, now = Date.now()): unknown {
  switch (name) {
    case 'auth/passkey/options':
    case 'auth/passkey/register/options':
      return { challenge: 'fake' }
    case 'auth/passkey':
      return { device: 'Chrome on Windows' }
    case 'auth/passkey/register': {
      view ??= freshView(now)
      const added = { id: `pk-${now}`, name: 'Firefox on Linux', host: location.hostname, createdAt: new Date(now).toISOString(), usedAt: null }
      view = { ...view, passkeys: [...view.passkeys, added] }
      return { id: added.id }
    }
    case 'auth/key':
      if (String(body.key ?? '').trim() !== FAKE_OWNER_KEY) throw fail('auth.wrongKey', {})
      return { device: 'Chrome on Windows' }
    case 'auth/sign-out':
      return { ok: true }
    case 'auth/invite/open':
    case 'auth/invite/wait':
      return fakeJoin(name, now)
    default:
      throw new Error(`fake: no ${name}`)
  }
}
