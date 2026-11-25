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
  /** Came in by an invitation (BTN-1655). */
  byInvite: boolean
}

/** An invitation of a new device still waiting (BTN-1655): unopened, or opened and waiting for "Let in". */
export interface InviteView {
  id: string
  createdAt: string
  expiresAt: string
  /** Who opened the link; `null` — nobody yet. */
  opened: { device: string; from: string; at: string; digits: string } | null
}

/** An outside address of the page (BTN-1661): a request came by it, or it was typed in the invitation dialog. */
export interface KnownOrigin {
  /** `https://name:port`, as the browser's address bar has it. */
  origin: string
  seenAt: string
}

/** `POST /api/auth/invites/create`: the secret of the link, shown only to the device that made it. */
export interface InviteMade {
  id: string
  secret: string
  expiresAt: string
  /** The page's outside addresses, the last one seen first: a page opened by `localhost` links to one of them. */
  origins: KnownOrigin[]
}

/**
 * What the new device sees of the invitation it opened (`invite/open`, `invite/wait`). `gone` — a wrong, expired or
 * cancelled link the device never opened: one answer for all, so a guess learns nothing; `used` — another device opened
 * it first.
 */
export type JoinView =
  | { state: 'waiting'; digits: string; expiresAt: string }
  | { state: 'admitted'; device: string }
  | { state: 'declined' | 'expired' | 'cancelled' | 'used' | 'gone' }

/** `GET /api/auth/devices`: the "Sign-in and devices" settings. */
export interface DevicesView {
  passkeys: PasskeyView[]
  devices: DeviceView[]
  /** The invitations still waiting, the earliest first. */
  invites: InviteView[]
  /** This browser's device id; `null` — not one of them. */
  current: string | null
  keySet: boolean
  /** An invitation turned the sign-in on (BTN-1656): without the key a proxy's name asks for it too. */
  signInOn: boolean
}
