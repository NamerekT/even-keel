import { expect, it } from 'vitest'
import { memoryDatabase } from '../storage/memory.js'
import { FakeAuthenticator } from './authenticator.fixture.js'
import { PasskeyDesk } from './passkeys.js'
import { ensureOwner, passkeysOf } from './store.js'

const HOST = 'hub.example.com'
const ORIGIN = `https://${HOST}`

async function deskOf() {
  const db = await memoryDatabase()
  const owner = await ensureOwner(db)
  let now = new Date('2026-11-24T08:00:00.000Z')
  const desk = new PasskeyDesk(db, owner.id, () => now)
  return { db, owner, desk, later: (ms: number) => (now = new Date(now.getTime() + ms)) }
}

async function registered(desk: PasskeyDesk, authenticator = new FakeAuthenticator()) {
  const options = await desk.registrationOptions(HOST)
  const passkey = await desk.register({ host: HOST, origin: ORIGIN, response: authenticator.create(options, ORIGIN), name: 'Chrome on Windows' })
  return { authenticator, passkey }
}

it('registers a passkey on the page host and signs in with it, its counter kept', async () => {
  const { db, owner, desk } = await deskOf()
  const { authenticator, passkey } = await registered(desk)
  expect(passkey).toMatchObject({ credentialId: authenticator.credentialId, host: HOST, name: 'Chrome on Windows', counter: 0 })
  const options = await desk.authenticationOptions(HOST)
  expect(options.rpId).toBe(HOST)
  expect(await desk.authenticate({ host: HOST, origin: ORIGIN, response: authenticator.get(options, ORIGIN) })).toMatchObject({ credentialId: passkey.credentialId })
  expect((await passkeysOf(db, owner.id))[0]).toMatchObject({ counter: 1, usedAt: '2026-11-24T08:00:00.000Z' })
})

it('does not sign in with a passkey made on another host name, nor with a challenge used or never given', async () => {
  const { desk } = await deskOf()
  const { authenticator } = await registered(desk)
  const elsewhere = await desk.authenticationOptions('other.example.com')
  await expect(desk.authenticate({ host: 'other.example.com', origin: 'https://other.example.com', response: authenticator.get(elsewhere, 'https://other.example.com') })).rejects.toThrow()
  const options = await desk.authenticationOptions(HOST)
  const answer = authenticator.get(options, ORIGIN)
  await desk.authenticate({ host: HOST, origin: ORIGIN, response: answer })
  await expect(desk.authenticate({ host: HOST, origin: ORIGIN, response: answer })).rejects.toThrow()
  await expect(desk.authenticate({ host: HOST, origin: ORIGIN, response: authenticator.get({ ...options, challenge: 'bm90LWdpdmVu' }, ORIGIN) })).rejects.toThrow()
})

it('refuses an answer for another RP ID or origin, and a challenge past its time', async () => {
  const { desk, later } = await deskOf()
  const { authenticator } = await registered(desk)
  const options = await desk.authenticationOptions(HOST)
  await expect(desk.authenticate({ host: HOST, origin: ORIGIN, response: authenticator.get(options, ORIGIN, 'other.example.com') })).rejects.toThrow()
  const second = await desk.authenticationOptions(HOST)
  await expect(desk.authenticate({ host: HOST, origin: ORIGIN, response: authenticator.get(second, 'https://evil.example.net') })).rejects.toThrow()
  const third = await desk.authenticationOptions(HOST)
  later(10 * 60_000)
  await expect(desk.authenticate({ host: HOST, origin: ORIGIN, response: authenticator.get(third, ORIGIN) })).rejects.toThrow()
})

it('offers a new registration without the passkeys already on the host, and removes one', async () => {
  const { db, owner, desk } = await deskOf()
  const { passkey } = await registered(desk)
  expect((await desk.registrationOptions(HOST)).excludeCredentials?.map((each) => each.id)).toEqual([passkey.credentialId])
  expect((await desk.registrationOptions('other.example.com')).excludeCredentials).toEqual([])
  expect(await desk.remove(passkey.credentialId)).toBe(true)
  expect(await passkeysOf(db, owner.id)).toEqual([])
})
