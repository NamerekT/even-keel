import type { DeviceBook } from '../guard.js'
import type { Db } from '../storage/database.js'
import { ensureOwner, hashOf, issueToken, keyMarkOf, liveTokens, revokeToken, signInOnSince, tokenSeen, turnSignInOff, turnSignInOn, type AccessToken } from './store.js'

/** How often a token's `seen_at` and `seen_from` reach the database; the memory has them at once. */
export const SEEN_WRITE_MS = 60_000

export interface BookOptions {
  clock?: () => Date
  /** The tokens just revoked: their devices' open streams close (`EventHub.closeTagged`). */
  revoked?: (ids: string[]) => void
  log?: (line: string) => void
}

/**
 * The live device tokens of the page (BTN-1619, `docs/web/sign-in.md`), held in memory so that the guard stays
 * synchronous: loaded from `access_tokens` at the start, every change written through.
 */
export class AccessBook implements DeviceBook {
  /** By the SHA-256 of the secret. */
  private readonly byHash = new Map<string, AccessToken>()
  private readonly written = new Map<string, number>()
  private pending: Promise<unknown> = Promise.resolve()
  /** An invitation turned the sign-in on (`sign_in_on`): a hub without the key asks by a proxy's name too. */
  private on = false

  private constructor(
    private readonly db: Db,
    readonly person: string,
    private readonly options: BookOptions,
  ) {}

  static async load(db: Db, options: BookOptions = {}): Promise<AccessBook> {
    const owner = await ensureOwner(db)
    const book = new AccessBook(db, owner.id, options)
    for (const { token, secretHash } of await liveTokens(db)) book.byHash.set(secretHash, token)
    book.on = (await signInOnSince(db)) !== null
    return book
  }

  find(secret: string): AccessToken | undefined {
    return this.byHash.get(hashOf(secret))
  }

  /** The devices signed in, the earliest first. */
  devices(): AccessToken[] {
    return [...this.byHash.values()]
  }

  seen(token: AccessToken, address: string): void {
    const now = this.now()
    const held = this.entryOf(token.id)
    if (held === undefined) return
    held[1].seenAt = now.toISOString()
    held[1].seenFrom = address
    const last = this.written.get(token.id) ?? 0
    if (now.getTime() - last < SEEN_WRITE_MS) return
    this.written.set(token.id, now.getTime())
    this.write(`the sign-in of ${token.device} seen`, tokenSeen(this.db, token.id, { at: now, address }))
  }

  async signIn(entry: { device: string; address: string; keyMark: string | null; passkeyHost?: string | null; inviteId?: string | null }): Promise<{ token: AccessToken; secret: string }> {
    const now = this.now()
    const issued = await issueToken(this.db, { person: this.person, rights: 'owner', device: entry.device, keyMark: entry.keyMark, passkeyHost: entry.passkeyHost, inviteId: entry.inviteId, now })
    await tokenSeen(this.db, issued.token.id, { at: now, address: entry.address })
    const token = { ...issued.token, seenAt: now.toISOString(), seenFrom: entry.address }
    this.byHash.set(hashOf(issued.secret), token)
    this.written.set(token.id, now.getTime())
    return { token, secret: issued.secret }
  }

  /** Whether the token was live. */
  async revoke(id: string): Promise<boolean> {
    return (await this.revokeWhere((token) => token.id === id)) > 0
  }

  /** Signs out every device but this one; how many. */
  revokeOthers(keep: string): Promise<number> {
    return this.revokeWhere((token) => token.id !== keep)
  }

  /**
   * The owner key is this one now (`null` — none): every device signed in with another key is signed out, the ones
   * signed in with a passkey stay. How many went.
   */
  keyIs(key: string | null): Promise<number> {
    const mark = key === null ? null : keyMarkOf(key)
    return this.revokeWhere((token) => token.keyMark !== null && token.keyMark !== mark)
  }

  signInOn(): boolean {
    return this.on
  }

  /** A device was let in by an invitation (BTN-1656): whether the sign-in was off until now. */
  async turnSignInOn(): Promise<boolean> {
    if (this.on) return false
    await turnSignInOn(this.db, this.now())
    this.on = true
    return true
  }

  /** Back to a hub that asks nobody: every device is signed out, so a later invitation revives no old token; how many. */
  async turnSignInOff(): Promise<number> {
    await turnSignInOff(this.db)
    this.on = false
    return this.revokeWhere(() => true)
  }

  /** The writes in flight are done: for tests and the service's stop. */
  async settled(): Promise<void> {
    await this.pending
  }

  private async revokeWhere(match: (token: AccessToken) => boolean): Promise<number> {
    const gone = [...this.byHash].filter(([, token]) => match(token))
    if (gone.length === 0) return 0
    const at = this.now()
    for (const [hash] of gone) this.byHash.delete(hash)
    for (const [, token] of gone) await revokeToken(this.db, token.id, at)
    this.options.revoked?.(gone.map(([, token]) => token.id))
    return gone.length
  }

  private entryOf(id: string): [string, AccessToken] | undefined {
    for (const entry of this.byHash) if (entry[1].id === id) return entry
    return undefined
  }

  private write(what: string, done: Promise<unknown>): void {
    this.pending = this.pending.then(() => done).catch((error: unknown) => {
      ;(this.options.log ?? console.warn)(`access: ${what} not written: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private now(): Date {
    return this.options.clock?.() ?? new Date()
  }
}
