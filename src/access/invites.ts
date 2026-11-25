import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { fail } from '../notice/notice.js'
import type { Db } from '../storage/database.js'
import type { AccessBook } from './book.js'
import { hashOf, type AccessToken } from './store.js'
import type { InviteMade, InviteView, JoinView } from './view.js'

/** How long a link lives: after it nobody can open it, and an opened one can no longer be let in. */
export const INVITE_MS = 10 * 60_000
/** How long `invite/wait` holds its answer when nothing changes: the new device asks again. */
export const WAIT_MS = 25_000
/**
 * How long after "Let in" the claiming browser may still collect its sign-in again while its token was never presented,
 * when the invitation itself ends sooner: the answer that carried the token may have been lost (BTN-1664).
 */
export const REISSUE_MS = 2 * 60_000
/** How many invitations wait at once. */
export const MAX_INVITES = 5
/** How long an invitation stays in the table after it expired. */
const KEPT_MS = 24 * 60 * 60_000

type State = 'waiting' | 'opened' | 'admitted' | 'declined' | 'cancelled' | 'used'

interface InviteRow {
  id: string
  created_by: string | null
  created_at: string
  expires_at: string
  state: State
  claim_hash: string | null
  opened_at: string | null
  opened_device: string | null
  opened_from: string | null
  digits: string | null
  decided_at: string | null
  token_id: string | null
}

const COLUMNS = 'id, created_by, created_at, expires_at, state, claim_hash, opened_at, opened_device, opened_from, digits, decided_at, token_id'

export interface InviteDeskOptions {
  clock?: () => Date
  /** The invitations or the devices changed: the pages read "Sign-in and devices" anew (the `devices` event). */
  changed?: () => void
  log?: (line: string) => void
  waitMs?: number
  digits?: () => string
}

/** What the new device gets: the view, and the secrets its browser keeps in cookies. */
export interface JoinAnswer {
  view: JoinView
  /** The secret of this browser's claim on the invitation, set once, when it opens the link first. */
  claim?: string
  /** The device token, once a person let the device in. */
  signedIn?: { token: AccessToken; secret: string }
}

/**
 * The invitations of a new device (BTN-1655, `docs/web/sign-in.md`): a device signed in makes a link, the first browser
 * that opens it claims it with a secret of its own, a person on any device signed in lets it in or declines it, and the
 * claiming browser alone collects the token. The table `device_invites` keeps only hashes of the link and the claim.
 */
export class InviteDesk {
  private readonly waiters = new Map<string, Set<() => void>>()

  constructor(
    private readonly db: Db,
    private readonly book: AccessBook,
    private readonly options: InviteDeskOptions = {},
  ) {}

  async create(by: string | null): Promise<Omit<InviteMade, 'origins'>> {
    const now = this.now()
    await this.db.query('delete from device_invites where expires_at < $1', [new Date(now.getTime() - KEPT_MS).toISOString()])
    if ((await this.live()).length >= MAX_INVITES) throw fail('auth.invitesFull', { count: MAX_INVITES })
    const secret = randomBytes(24).toString('base64url')
    const id = randomUUID()
    const expiresAt = new Date(now.getTime() + INVITE_MS).toISOString()
    await this.db.query(
      `insert into device_invites (id, person_id, link_hash, created_by, created_at, expires_at, state) values ($1, $2, $3, $4, $5, $6, 'waiting')`,
      [id, this.book.person, hashOf(secret), by, now.toISOString(), expiresAt],
    )
    this.log(`access: an invitation of a new device was made; it lives until ${expiresAt}`)
    this.changed(id)
    return { id, secret, expiresAt }
  }

  /** The invitations still waiting, for "Devices". */
  async live(): Promise<InviteView[]> {
    const { rows } = await this.db.query<InviteRow>(
      `select ${COLUMNS} from device_invites where state in ('waiting', 'opened') and expires_at > $1 order by created_at, id`,
      [this.now().toISOString()],
    )
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      opened: row.state === 'opened' ? { device: row.opened_device!, from: row.opened_from!, at: row.opened_at!, digits: row.digits! } : null,
    }))
  }

  /**
   * A browser opened the link: the first one claims it, the same one again sees its claim, any other `used`. A wrong,
   * expired or cancelled link is `gone`, one answer for all.
   */
  async open(secret: string, claim: string | undefined, entry: { device: string; address: string }): Promise<JoinAnswer> {
    const row = await this.rowBy('link_hash', hashOf(secret))
    if (row === undefined) return { view: { state: 'gone' } }
    if (claim !== undefined && row.claim_hash === hashOf(claim)) return this.answerOf(row, entry.address)
    const now = this.now().toISOString()
    if (row.expires_at <= now) return { view: { state: 'gone' } }
    if (row.claim_hash !== null) return { view: { state: 'used' } }
    if (row.state !== 'waiting') return { view: { state: 'gone' } }
    const fresh = randomBytes(32).toString('base64url')
    const digits = this.options.digits?.() ?? String(randomInt(0, 100)).padStart(2, '0')
    const { rows } = await this.db.query<InviteRow>(
      `update device_invites set state = 'opened', claim_hash = $2, opened_at = $3, opened_device = $4, opened_from = $5, digits = $6
       where id = $1 and state = 'waiting' and claim_hash is null and expires_at > $3 returning ${COLUMNS}`,
      [row.id, hashOf(fresh), now, entry.device, entry.address, digits],
    )
    // Another browser claimed it between the read and the write.
    if (rows[0] === undefined) return { view: { state: 'used' } }
    this.log(`access: ${entry.device} (${entry.address}) opened an invitation; it waits for a person to let it in`)
    this.changed(row.id)
    return { view: { state: 'waiting', digits, expiresAt: row.expires_at }, claim: fresh }
  }

  /** What became of this browser's claim; while it waits, the answer waits up to `WAIT_MS` for a change. */
  async wait(claim: string | undefined, address: string): Promise<JoinAnswer> {
    if (claim === undefined) return { view: { state: 'gone' } }
    const hash = hashOf(claim)
    const row = await this.rowBy('claim_hash', hash)
    if (row === undefined) return { view: { state: 'gone' } }
    const first = await this.answerOf(row, address)
    if (first.view.state !== 'waiting') return first
    await this.nap(row.id, Date.parse(row.expires_at) - this.now().getTime())
    const again = await this.rowBy('claim_hash', hash)
    return again === undefined ? { view: { state: 'gone' } } : this.answerOf(again, address)
  }

  /**
   * "Let in": the claiming browser gets its token at its next ask, and the sign-in is on from now (BTN-1656). Whether
   * this turned it on.
   */
  async admit(id: string): Promise<boolean> {
    const row = await this.decide(id, 'admitted', ['opened'])
    this.log(`access: ${row.opened_device} (${row.opened_from}) was let in by an invitation`)
    const turned = await this.book.turnSignInOn()
    if (turned) {
      this.log('access: the sign-in is on: a proxy name asks for it from now')
      // The page state's `signInOn` checks the setup's "Phone access" step (BTN-1638): the change before this one came too early.
      this.options.changed?.()
    }
    return turned
  }

  /** Back to a hub without the key that asks nobody; every device is signed out. How many. */
  async signInOff(): Promise<number> {
    const count = await this.book.turnSignInOff()
    this.log(`access: the sign-in was turned off and ${count} device(s) signed out`)
    this.options.changed?.()
    return count
  }

  async decline(id: string): Promise<void> {
    const row = await this.decide(id, 'declined', ['opened'])
    this.log(`access: the invitation opened by ${row.opened_device} (${row.opened_from}) was declined`)
  }

  /** "Cancel": the link is dead, opened or not. */
  async cancel(id: string): Promise<void> {
    await this.decide(id, 'cancelled', ['waiting', 'opened'])
    this.log('access: an invitation of a new device was cancelled')
  }

  private async decide(id: string, to: State, from: readonly State[]): Promise<InviteRow> {
    const now = this.now().toISOString()
    const states = from.map((state) => `'${state}'`).join(', ')
    const { rows } = await this.db.query<InviteRow>(
      `update device_invites set state = $2, decided_at = $3 where id = $1 and state in (${states}) and expires_at > $3 returning ${COLUMNS}`,
      [id, to, now],
    )
    if (rows[0] === undefined) throw fail('auth.inviteGone', {})
    this.changed(id)
    return rows[0]
  }

  /** The claiming browser's view of its invitation; let in — the token, issued again only while none was presented. */
  private async answerOf(row: InviteRow, address: string): Promise<JoinAnswer> {
    switch (row.state) {
      case 'opened':
        return { view: row.expires_at <= this.now().toISOString() ? { state: 'expired' } : { state: 'waiting', digits: row.digits!, expiresAt: row.expires_at } }
      case 'admitted':
        return this.collect(row, address)
      case 'used':
        return this.reissue(row, address)
      case 'declined':
      case 'cancelled':
        return { view: { state: row.state } }
      default:
        return { view: { state: 'gone' } }
    }
  }

  /**
   * The claiming browser asks again after its token was issued: the answer that carried it never arrived (the phone's
   * screen went dark mid-wait), since no request has presented it. That token goes and a new one comes, so "Devices"
   * keeps one row; once presented, or after the window, the invitation is `gone`.
   */
  private async reissue(row: InviteRow, address: string): Promise<JoinAnswer> {
    const gone: JoinAnswer = { view: { state: 'gone' } }
    const old = row.token_id
    if (old === null || !this.book.isUnpresented(old)) return gone
    const now = this.now()
    const until = Math.max(Date.parse(row.expires_at), Date.parse(row.decided_at ?? row.expires_at) + REISSUE_MS)
    if (now.getTime() >= until) return gone
    // Two tabs of the same browser at once: one takes the old token over.
    const { rows } = await this.db.query<{ id: string }>(`update device_invites set token_id = null where id = $1 and token_id = $2 returning id`, [row.id, old])
    if (rows[0] === undefined) return gone
    await this.book.revoke(old)
    const device = row.opened_device!
    const signedIn = await this.book.signIn({ device, address, keyMark: null, inviteId: row.id })
    await this.db.query('update device_invites set token_id = $2 where id = $1', [row.id, signedIn.token.id])
    this.log(`access: ${device} (${address}) asked again for the sign-in its invitation gave, never used: a new token replaced it`)
    this.changed(row.id)
    return { view: { state: 'admitted', device }, signedIn }
  }

  private async collect(row: InviteRow, address: string): Promise<JoinAnswer> {
    const { rows } = await this.db.query<{ id: string }>(`update device_invites set state = 'used' where id = $1 and state = 'admitted' returning id`, [row.id])
    // Another tab of the same browser collected it first.
    if (rows[0] === undefined) return { view: { state: 'gone' } }
    const device = row.opened_device!
    const signedIn = await this.book.signIn({ device, address, keyMark: null, inviteId: row.id })
    await this.db.query('update device_invites set token_id = $2 where id = $1', [row.id, signedIn.token.id])
    this.changed(row.id)
    return { view: { state: 'admitted', device }, signedIn }
  }

  private async rowBy(column: 'link_hash' | 'claim_hash', hash: string): Promise<InviteRow | undefined> {
    const { rows } = await this.db.query<InviteRow>(`select ${COLUMNS} from device_invites where ${column} = $1`, [hash])
    return rows[0]
  }

  private nap(id: string, leftMs: number): Promise<void> {
    return new Promise((resolve) => {
      const waiters = this.waiters.get(id) ?? new Set()
      this.waiters.set(id, waiters)
      const done = () => {
        clearTimeout(timer)
        waiters.delete(done)
        if (waiters.size === 0) this.waiters.delete(id)
        resolve()
      }
      const timer = setTimeout(done, Math.max(0, Math.min(this.options.waitMs ?? WAIT_MS, leftMs + 50)))
      timer.unref?.()
      waiters.add(done)
    })
  }

  private wake(id: string): void {
    for (const done of [...(this.waiters.get(id) ?? [])]) done()
  }

  private changed(id: string): void {
    this.wake(id)
    this.options.changed?.()
  }

  private log(line: string): void {
    ;(this.options.log ?? console.log)(line)
  }

  private now(): Date {
    return this.options.clock?.() ?? new Date()
  }
}
