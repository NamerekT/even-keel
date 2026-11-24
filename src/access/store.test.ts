import { expect, it } from 'vitest'
import { memoryDatabase } from '../storage/memory.js'
import { permits } from './rights.js'
import { addPasskey, ensureOwner, issueToken, passkeyUsed, passkeysOf, revokeToken, tokenBySecret, tokenSeen, tokensOf } from './store.js'

const at = (time: string) => new Date(`2026-11-24T${time}.000Z`)

it('makes the owner once: a second start finds the same person', async () => {
  const db = await memoryDatabase()
  const first = await ensureOwner(db, at('08:00:00'))
  expect(first).toMatchObject({ name: 'Owner', createdAt: '2026-11-24T08:00:00.000Z' })
  expect(await ensureOwner(db, at('09:00:00'))).toEqual(first)
  expect((await db.query('select * from people')).rows).toHaveLength(1)
})

it('finds a token by its secret and never keeps the secret itself', async () => {
  const db = await memoryDatabase()
  const owner = await ensureOwner(db)
  const { token, secret } = await issueToken(db, { person: owner.id, rights: 'owner', device: 'Firefox on Linux', now: at('08:10:00') })
  expect(secret.length).toBeGreaterThanOrEqual(43)
  expect(await tokenBySecret(db, secret)).toEqual(token)
  expect(await tokenBySecret(db, `${secret}x`)).toBeUndefined()
  const stored = JSON.stringify((await db.query('select * from access_tokens')).rows)
  expect(stored).not.toContain(secret)
})

it('marks where and when a token was last seen', async () => {
  const db = await memoryDatabase()
  const owner = await ensureOwner(db)
  const { token, secret } = await issueToken(db, { person: owner.id, rights: 'owner', device: 'Safari on iPhone', now: at('08:10:00') })
  await tokenSeen(db, token.id, { at: at('08:20:00'), address: '192.0.2.7' })
  expect(await tokenBySecret(db, secret)).toMatchObject({ seenAt: '2026-11-24T08:20:00.000Z', seenFrom: '192.0.2.7' })
})

it('a revoked token is not found, yet stays in the person list', async () => {
  const db = await memoryDatabase()
  const owner = await ensureOwner(db)
  const { token, secret } = await issueToken(db, { person: owner.id, rights: 'owner', device: 'Chrome on Windows', now: at('08:10:00') })
  await revokeToken(db, token.id, at('08:30:00'))
  expect(await tokenBySecret(db, secret)).toBeUndefined()
  expect((await tokensOf(db, owner.id)).map((kept) => kept.revokedAt)).toEqual(['2026-11-24T08:30:00.000Z'])
})

it('keeps a passkey for the host it was made on and moves its counter at each sign-in', async () => {
  const db = await memoryDatabase()
  const owner = await ensureOwner(db)
  await addPasskey(db, { credentialId: 'Y3JlZA', person: owner.id, publicKey: 'cGs', counter: 0, host: 'hub.example.com', name: 'Laptop', now: at('08:00:00') })
  await passkeyUsed(db, 'Y3JlZA', 4, at('09:00:00'))
  expect(await passkeysOf(db, owner.id)).toEqual([
    { credentialId: 'Y3JlZA', person: owner.id, publicKey: 'cGs', counter: 4, host: 'hub.example.com', name: 'Laptop', createdAt: '2026-11-24T08:00:00.000Z', usedAt: '2026-11-24T09:00:00.000Z' },
  ])
})

it('lets only the owner rights through for now', () => {
  expect(permits('owner')).toBe(true)
  expect(permits('watch')).toBe(false)
})
