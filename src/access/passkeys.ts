import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { decodeClientDataJSON, isoBase64URL } from '@simplewebauthn/server/helpers'
import { fail } from '../notice/notice.js'
import type { Db } from '../storage/database.js'
import { passkeyHost } from './passkey-host.js'
import { addPasskey, passkeyById, passkeysOf, passkeyUsed, removePasskey, type Passkey } from './store.js'

/** How long a challenge waits for the browser's answer. */
export const CHALLENGE_MS = 5 * 60_000
const RP_NAME = 'Even Keel'
const USER_NAME = 'owner'
/** At most this many ceremonies wait at once: the sign-in routes are open to anyone who reaches the page. */
const PENDING_LIMIT = 200

export interface PasskeyOptions {
  clock?: () => Date
  /** A passkey made, used or removed: the pages read "Sign-in and devices" anew (the `devices` event, BTN-1662). */
  changed?: () => void
}

interface Pending {
  kind: 'register' | 'signIn'
  host: string
  expires: number
}

/**
 * The WebAuthn ceremonies of the page (BTN-1619, `docs/web/sign-in.md`): a passkey is made and used on the host name
 * the page was opened by — its RP ID — and works only there. Attestation `none`, discoverable credentials.
 */
export class PasskeyDesk {
  /** By the challenge, base64url: an answer names its own. */
  private readonly pending = new Map<string, Pending>()

  private readonly clock: () => Date
  private readonly changed: () => void

  constructor(
    private readonly db: Db,
    private readonly person: string,
    options: PasskeyOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date())
    this.changed = options.changed ?? (() => {})
  }

  list(): Promise<Passkey[]> {
    return passkeysOf(this.db, this.person)
  }

  async remove(credentialId: string): Promise<boolean> {
    const removed = await removePasskey(this.db, credentialId)
    if (removed) this.changed()
    return removed
  }

  async registrationOptions(host: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    byName(host)
    const existing = (await this.list()).filter((passkey) => passkey.host === host)
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: host,
      userName: USER_NAME,
      userDisplayName: RP_NAME,
      userID: new TextEncoder().encode(this.person),
      attestationType: 'none',
      excludeCredentials: existing.map((passkey) => ({ id: passkey.credentialId })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    })
    this.hold(options.challenge, 'register', host)
    return options
  }

  async register(answer: { host: string; origin: string; response: RegistrationResponseJSON; name: string }): Promise<Passkey> {
    const challenge = this.take(answer.response.response.clientDataJSON, 'register', answer.host)
    const verified = await verifyRegistrationResponse({
      response: answer.response,
      expectedChallenge: challenge,
      expectedOrigin: answer.origin,
      expectedRPID: answer.host,
      requireUserVerification: false,
    }).catch(() => undefined)
    if (verified?.verified !== true) throw fail('auth.passkeyRefused', {})
    const { credential } = verified.registrationInfo
    const now = this.clock()
    await addPasskey(this.db, {
      credentialId: credential.id,
      person: this.person,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      host: answer.host,
      name: answer.name,
      now,
    })
    this.changed()
    return (await passkeyById(this.db, credential.id))!
  }

  async authenticationOptions(host: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    byName(host)
    const options = await generateAuthenticationOptions({ rpID: host, userVerification: 'preferred' })
    this.hold(options.challenge, 'signIn', host)
    return options
  }

  /** The passkey the answer is of; refuses one made on another host. */
  async authenticate(answer: { host: string; origin: string; response: AuthenticationResponseJSON }): Promise<Passkey> {
    const challenge = this.take(answer.response.response.clientDataJSON, 'signIn', answer.host)
    const passkey = await passkeyById(this.db, answer.response.id)
    if (passkey === undefined || passkey.person !== this.person || passkey.host !== answer.host) throw fail('auth.passkeyUnknown', {})
    const verified = await verifyAuthenticationResponse({
      response: answer.response,
      expectedChallenge: challenge,
      expectedOrigin: answer.origin,
      expectedRPID: answer.host,
      credential: { id: passkey.credentialId, publicKey: isoBase64URL.toBuffer(passkey.publicKey), counter: passkey.counter },
      requireUserVerification: false,
    }).catch(() => undefined)
    if (verified?.verified !== true) throw fail('auth.passkeyRefused', {})
    await passkeyUsed(this.db, passkey.credentialId, verified.authenticationInfo.newCounter, this.clock())
    this.changed()
    return passkey
  }

  private hold(challenge: string, kind: Pending['kind'], host: string): void {
    const now = this.clock().getTime()
    for (const [key, each] of this.pending) if (each.expires <= now) this.pending.delete(key)
    while (this.pending.size >= PENDING_LIMIT) this.pending.delete(this.pending.keys().next().value!)
    this.pending.set(challenge, { kind, host, expires: now + CHALLENGE_MS })
  }

  /** The challenge the answer names, used once: one not given, of another kind or host, or past its time is refused. */
  private take(clientDataJSON: string, kind: Pending['kind'], host: string): string {
    let challenge: string
    try {
      challenge = decodeClientDataJSON(clientDataJSON).challenge
    } catch {
      throw fail('auth.passkeyRefused', {})
    }
    const held = this.pending.get(challenge)
    this.pending.delete(challenge)
    if (held === undefined || held.kind !== kind || held.host !== host || held.expires <= this.clock().getTime()) throw fail('auth.passkeyRefused', {})
    return challenge
  }
}

/** A page opened by an IP address gets no ceremony: the browser would refuse the RP ID (BTN-1632). */
function byName(host: string): void {
  if (!passkeyHost(host)) throw fail('auth.passkeyByName', {})
}
