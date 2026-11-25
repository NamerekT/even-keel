import { expect, it } from 'vitest'
import { memoryDatabase } from '../storage/memory.js'
import { AccessBook } from './book.js'
import { keyMarkOf, tokensOf } from './store.js'

const KEY = 'owner-key-0123456789abcdef'

async function bookOf(start = '2026-11-24T08:00:00.000Z') {
  const db = await memoryDatabase()
  let now = new Date(start)
  const revoked: string[][] = []
  const changes = { count: 0 }
  const book = await AccessBook.load(db, { clock: () => now, revoked: (ids) => revoked.push(ids), changed: () => changes.count++ })
  return { db, book, revoked, changes, later: (ms: number) => (now = new Date(now.getTime() + ms)) }
}

it('tells the pages on every token issued or revoked, not on a token seen nor on a revoke that took none (BTN-1662)', async () => {
  const { book, changes, later } = await bookOf()
  const first = await book.signIn({ device: 'A', address: '192.0.2.1', keyMark: keyMarkOf(KEY) })
  const second = await book.signIn({ device: 'B', address: '192.0.2.2', keyMark: null })
  await book.signIn({ device: 'C', address: '192.0.2.3', keyMark: null })
  expect(changes.count).toBe(3)
  later(120_000)
  book.seen(first.token, '192.0.2.9')
  await book.settled()
  expect(changes.count).toBe(3)
  await book.revoke(second.token.id)
  expect(changes.count).toBe(4)
  await book.revoke(second.token.id)
  expect(await book.keyIs(KEY)).toBe(0)
  expect(changes.count).toBe(4)
  await book.revokeOthers(first.token.id)
  expect(changes.count).toBe(5)
  await book.keyIs(null)
  expect(changes.count).toBe(6)
  await book.turnSignInOff()
  expect(changes.count).toBe(6)
})

it('signs a device in with a token of its own, found by its secret and kept across a load', async () => {
  const { db, book } = await bookOf()
  const { token, secret } = await book.signIn({ device: 'Firefox on Linux', address: '192.0.2.7', keyMark: keyMarkOf(KEY) })
  expect(token).toMatchObject({ device: 'Firefox on Linux', rights: 'owner', seenFrom: '192.0.2.7', keyMark: keyMarkOf(KEY) })
  expect(book.find(secret)).toEqual(token)
  expect(book.find(`${secret}x`)).toBeUndefined()
  const again = await AccessBook.load(db)
  expect(again.find(secret)?.id).toBe(token.id)
  expect(again.devices().map((each) => each.id)).toEqual([token.id])
})

it('writes when a token was seen at most once a minute, the memory at once', async () => {
  const { db, book, later } = await bookOf()
  const { token } = await book.signIn({ device: 'Safari on iPhone', address: '192.0.2.7', keyMark: null })
  later(10_000)
  book.seen(token, '192.0.2.8')
  await book.settled()
  expect(book.devices()[0]).toMatchObject({ seenFrom: '192.0.2.8', seenAt: '2026-11-24T08:00:10.000Z' })
  expect((await tokensOf(db, token.person))[0]).toMatchObject({ seenFrom: '192.0.2.7', seenAt: '2026-11-24T08:00:00.000Z' })
  later(60_000)
  book.seen(token, '192.0.2.9')
  await book.settled()
  expect((await tokensOf(db, token.person))[0]).toMatchObject({ seenFrom: '192.0.2.9', seenAt: '2026-11-24T08:01:10.000Z' })
})

it('signs a device out, or every other one, and tells whose streams to close', async () => {
  const { book, revoked } = await bookOf()
  const first = await book.signIn({ device: 'A', address: '192.0.2.1', keyMark: null })
  const second = await book.signIn({ device: 'B', address: '192.0.2.2', keyMark: null })
  const third = await book.signIn({ device: 'C', address: '192.0.2.3', keyMark: null })
  expect(await book.revoke(second.token.id)).toBe(true)
  expect(await book.revoke(second.token.id)).toBe(false)
  expect(book.find(second.secret)).toBeUndefined()
  expect(await book.revokeOthers(first.token.id)).toBe(1)
  expect(book.devices().map((each) => each.device)).toEqual(['A'])
  expect(revoked).toEqual([[second.token.id], [third.token.id]])
})

it('a new owner key signs out every device signed in with the old one; passkey sign-ins stay', async () => {
  const { db, book, revoked } = await bookOf()
  const byKey = await book.signIn({ device: 'Key', address: '192.0.2.1', keyMark: keyMarkOf(KEY) })
  const byPasskey = await book.signIn({ device: 'Passkey', address: '192.0.2.2', keyMark: null })
  expect(await book.keyIs(KEY)).toBe(0)
  expect(await book.keyIs('another-key-0123456789abcdef')).toBe(1)
  expect(book.find(byKey.secret)).toBeUndefined()
  expect(book.find(byPasskey.secret)).toBeDefined()
  expect(revoked).toEqual([[byKey.token.id]])
  expect((await tokensOf(db, byKey.token.person)).find((each) => each.id === byKey.token.id)?.revokedAt).not.toBeNull()
  const unset = await book.signIn({ device: 'Key 2', address: '192.0.2.1', keyMark: keyMarkOf('another-key-0123456789abcdef') })
  expect(await book.keyIs(null)).toBe(1)
  expect(book.find(unset.secret)).toBeUndefined()
})

it('keeps the sign-in turned on by an invitation across a load and through signing every device out (BTN-1656)', async () => {
  const { db, book } = await bookOf()
  expect(book.signInOn()).toBe(false)
  expect(await book.turnSignInOn()).toBe(true)
  expect(await book.turnSignInOn()).toBe(false)
  const phone = await book.signIn({ device: 'Safari on iPhone', address: '192.0.2.7', keyMark: null })
  await book.revoke(phone.token.id)
  expect(book.signInOn()).toBe(true)
  expect((await AccessBook.load(db)).signInOn()).toBe(true)
})

it('turning the sign-in off signs every device out, kept across a load (BTN-1656)', async () => {
  const { db, book, revoked } = await bookOf()
  await book.turnSignInOn()
  const phone = await book.signIn({ device: 'Safari on iPhone', address: '192.0.2.7', keyMark: null })
  const laptop = await book.signIn({ device: 'Firefox on Linux', address: '192.0.2.8', keyMark: null })
  expect(await book.turnSignInOff()).toBe(2)
  expect(book.signInOn()).toBe(false)
  expect(book.devices()).toEqual([])
  expect(revoked).toEqual([[phone.token.id, laptop.token.id]])
  expect((await AccessBook.load(db)).signInOn()).toBe(false)
})
