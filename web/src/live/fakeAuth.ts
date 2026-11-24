import { fail } from '../../../src/notice/notice.js'
import type { DevicesView } from '../../../src/access/view.js'

/** The owner key `dev:fake` takes on its sign-in screen (`/?signIn`); any other is wrong. */
export const FAKE_OWNER_KEY = 'owner-key'

const HOUR_MS = 60 * 60 * 1000

/** "Sign-in and devices" of `dev:fake`: two passkeys and two devices, this browser one of them. */
function freshView(now: number): DevicesView {
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR_MS).toISOString()
  return {
    passkeys: [
      { id: 'pk-phone', name: 'Safari on iPhone', host: 'hub.example.ts.net', createdAt: at(30), usedAt: at(0.1) },
      { id: 'pk-office', name: 'Chrome on Windows', host: 'hub.example.ts.net', createdAt: at(28), usedAt: at(2) },
    ],
    devices: [
      { id: 'dev-phone', device: 'Safari on iPhone', createdAt: at(30), seenAt: at(0), seenFrom: '100.64.0.12', byKey: false },
      { id: 'dev-office', device: 'Chrome on Windows', createdAt: at(28), seenAt: at(2), seenFrom: '100.64.0.7', byKey: true },
    ],
    current: 'dev-phone',
    keySet: true,
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
    default:
      return fakeSignInPost(name, body, now)
  }
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
    default:
      throw new Error(`fake: no ${name}`)
  }
}
