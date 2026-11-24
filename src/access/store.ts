import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { Db, Queryable } from '../storage/database.js'
import type { Rights } from './rights.js'

/**
 * Who signs in to the page, in the state database (step 78, `docs/storage.md`): the people, each device's token and the
 * passkeys. A token's secret is shown once, when it is issued; the database keeps only its SHA-256.
 */

export const OWNER_NAME = 'Owner'

export interface Person {
  id: string
  name: string
  createdAt: string
}

export interface AccessToken {
  id: string
  person: string
  rights: Rights
  /** The device as its browser and system name it. */
  device: string
  createdAt: string
  seenAt: string | null
  /** The address the token was last seen from. */
  seenFrom: string | null
  revokedAt: string | null
  /** The owner key's mark for a sign-in with the key (`keyMarkOf`); `null` — a passkey's. */
  keyMark: string | null
}

export interface Passkey {
  /** The credential's id, base64url. */
  credentialId: string
  person: string
  /** The COSE public key, base64url. */
  publicKey: string
  counter: number
  /** The page's host name the passkey was made on: it signs in only there. */
  host: string
  name: string
  createdAt: string
  usedAt: string | null
}

interface PersonRow {
  id: string
  name: string
  created_at: string
}

interface TokenRow {
  id: string
  person_id: string
  rights: Rights
  device: string
  created_at: string
  seen_at: string | null
  seen_from: string | null
  revoked_at: string | null
  key_mark: string | null
}

interface PasskeyRow {
  credential_id: string
  person_id: string
  public_key: string
  counter: string | number
  host: string
  name: string
  created_at: string
  used_at: string | null
}

const TOKEN_COLUMNS = 'id, person_id, rights, device, created_at, seen_at, seen_from, revoked_at, key_mark'
const PASSKEY_COLUMNS = 'credential_id, person_id, public_key, counter, host, name, created_at, used_at'

export const hashOf = (secret: string) => createHash('sha256').update(secret).digest('hex')

/** What a token signed in with the owner key keeps of it: enough to tell the key changed, never the key. */
export const keyMarkOf = (key: string) => createHmac('sha256', key).update('even-keel-owner-key').digest('hex')

const personOf = (row: PersonRow): Person => ({ id: row.id, name: row.name, createdAt: row.created_at })

const tokenOf = (row: TokenRow): AccessToken => ({
  id: row.id,
  person: row.person_id,
  rights: row.rights,
  device: row.device,
  createdAt: row.created_at,
  seenAt: row.seen_at,
  seenFrom: row.seen_from,
  revokedAt: row.revoked_at,
  keyMark: row.key_mark,
})

const passkeyOf = (row: PasskeyRow): Passkey => ({
  credentialId: row.credential_id,
  person: row.person_id,
  publicKey: row.public_key,
  counter: Number(row.counter),
  host: row.host,
  name: row.name,
  createdAt: row.created_at,
  usedAt: row.used_at,
})

/** The owner, made at the first start of a database without people; every later start finds the same one. */
export async function ensureOwner(db: Db, now = new Date()): Promise<Person> {
  await db.query('insert into people (id, name, created_at) select $1, $2, $3 where not exists (select 1 from people)', [
    randomUUID(),
    OWNER_NAME,
    now.toISOString(),
  ])
  const { rows } = await db.query<PersonRow>('select id, name, created_at from people order by created_at, id limit 1')
  return personOf(rows[0]!)
}

export interface NewToken {
  person: string
  rights: Rights
  device: string
  keyMark?: string | null
  now?: Date
}

/** A new device token: the secret is returned here once and never kept. */
export async function issueToken(db: Db, fresh: NewToken): Promise<{ token: AccessToken; secret: string }> {
  const secret = randomBytes(32).toString('base64url')
  const { rows } = await db.query<TokenRow>(
    `insert into access_tokens (id, person_id, rights, secret_hash, device, created_at, key_mark) values ($1, $2, $3, $4, $5, $6, $7)
     returning ${TOKEN_COLUMNS}`,
    [randomUUID(), fresh.person, fresh.rights, hashOf(secret), fresh.device, (fresh.now ?? new Date()).toISOString(), fresh.keyMark ?? null],
  )
  return { token: tokenOf(rows[0]!), secret }
}

/** The token of this secret, unless it was revoked. */
export async function tokenBySecret(db: Queryable, secret: string): Promise<AccessToken | undefined> {
  const { rows } = await db.query<TokenRow>(`select ${TOKEN_COLUMNS} from access_tokens where secret_hash = $1 and revoked_at is null`, [hashOf(secret)])
  return rows[0] === undefined ? undefined : tokenOf(rows[0])
}

/** Every token not revoked, with the hash of its secret: what the guard's book holds. */
export async function liveTokens(db: Queryable): Promise<{ token: AccessToken; secretHash: string }[]> {
  const { rows } = await db.query<TokenRow & { secret_hash: string }>(`select ${TOKEN_COLUMNS}, secret_hash from access_tokens where revoked_at is null order by created_at, id`)
  return rows.map((row) => ({ token: tokenOf(row), secretHash: row.secret_hash }))
}

export async function tokensOf(db: Queryable, person: string): Promise<AccessToken[]> {
  const { rows } = await db.query<TokenRow>(`select ${TOKEN_COLUMNS} from access_tokens where person_id = $1 order by created_at, id`, [person])
  return rows.map(tokenOf)
}

export async function tokenSeen(db: Db, id: string, seen: { at: Date; address: string }): Promise<void> {
  await db.query('update access_tokens set seen_at = $2, seen_from = $3 where id = $1', [id, seen.at.toISOString(), seen.address])
}

/** A revoked token stays in the list with its time; revoking it again keeps the first time. */
export async function revokeToken(db: Db, id: string, at = new Date()): Promise<void> {
  await db.query('update access_tokens set revoked_at = $2 where id = $1 and revoked_at is null', [id, at.toISOString()])
}

export interface NewPasskey extends Omit<Passkey, 'createdAt' | 'usedAt'> {
  now?: Date
}

export async function addPasskey(db: Db, passkey: NewPasskey): Promise<void> {
  await db.query(
    'insert into passkeys (credential_id, person_id, public_key, counter, host, name, created_at) values ($1, $2, $3, $4, $5, $6, $7)',
    [passkey.credentialId, passkey.person, passkey.publicKey, passkey.counter, passkey.host, passkey.name, (passkey.now ?? new Date()).toISOString()],
  )
}

export async function passkeysOf(db: Queryable, person: string): Promise<Passkey[]> {
  const { rows } = await db.query<PasskeyRow>(
    `select ${PASSKEY_COLUMNS} from passkeys where person_id = $1 order by created_at, credential_id`,
    [person],
  )
  return rows.map(passkeyOf)
}

/** A sign-in with the passkey: its new counter and the time. */
export async function passkeyUsed(db: Db, credentialId: string, counter: number, at = new Date()): Promise<void> {
  await db.query('update passkeys set counter = $2, used_at = $3 where credential_id = $1', [credentialId, counter, at.toISOString()])
}

export async function passkeyById(db: Queryable, credentialId: string): Promise<Passkey | undefined> {
  const { rows } = await db.query<PasskeyRow>(`select ${PASSKEY_COLUMNS} from passkeys where credential_id = $1`, [credentialId])
  return rows[0] === undefined ? undefined : passkeyOf(rows[0])
}

/** Whether there was one to remove. */
export async function removePasskey(db: Db, credentialId: string): Promise<boolean> {
  const { affectedRows } = await db.query('delete from passkeys where credential_id = $1', [credentialId])
  return (affectedRows ?? 0) > 0
}
