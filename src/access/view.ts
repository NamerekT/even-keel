// What the sign-in routes answer the page (BTN-1619, `docs/web/sign-in.md`): types only, the page imports them.

/** `GET /api/auth/state`: whether this browser is in and whether the hub has an owner key at all. */
export interface AuthState {
  signedIn: boolean
  /** `EVEN_KEEL_TOKEN` is set: without it only loopback names reach the page. */
  keySet: boolean
  /** The hub has a passkey made on the host name of this request: without one the screen offers no passkey button. */
  passkeyHere: boolean
  /** This browser's sign-in; `null` — none (this machine by a loopback name, or not signed in). */
  device: string | null
}

export interface PasskeyView {
  id: string
  name: string
  /** The host name it was made on: it signs in only there. */
  host: string
  createdAt: string
  usedAt: string | null
}

export interface DeviceView {
  id: string
  device: string
  createdAt: string
  seenAt: string | null
  seenFrom: string | null
  /** Signed in with the owner key: changing the key signs it out. */
  byKey: boolean
  /** The host name of the passkey it signed in with; `null` — by key, or signed in before it was kept. */
  passkeyHost: string | null
}

/** `GET /api/auth/devices`: the "Sign-in and devices" settings. */
export interface DevicesView {
  passkeys: PasskeyView[]
  devices: DeviceView[]
  /** This browser's device id; `null` — not one of them. */
  current: string | null
  keySet: boolean
}
