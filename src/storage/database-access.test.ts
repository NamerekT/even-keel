import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { ensureOwner, passkeysOf, tokensOf } from '../access/store.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const OWNER = 'a1000000-0000-4000-8000-000000000001'

it('step 79 adds the people, their device tokens and passkeys, none before it (BTN-1618)', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 77))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(79))
    expect(await databaseVersion(frozen)).toBe(79)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 79, 79)
    expect(await ensureOwner(frozen)).toEqual({ id: OWNER, name: 'Owner', createdAt: '2026-11-24T08:00:00.000Z' })
    expect((await tokensOf(frozen, OWNER)).map((token) => [token.device, token.rights, token.revokedAt])).toEqual([
      ['Firefox on Linux', 'owner', null],
      ['Safari on iPhone', 'owner', '2026-11-24T09:30:00.000Z'],
    ])
    expect(await passkeysOf(frozen, OWNER)).toEqual([
      {
        credentialId: 'Y3JlZGVudGlhbC1leGFtcGxl',
        person: OWNER,
        publicKey: 'cHVibGljLWtleS1leGFtcGxl',
        counter: 3,
        host: 'hub.example.com',
        name: 'Laptop',
        createdAt: '2026-11-24T08:05:00.000Z',
        usedAt: '2026-11-24T09:00:00.000Z',
      },
    ])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(78))
    await upgraded.exec(STEPS[76]!)
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
    expect((await upgraded.query('select * from people')).rows).toEqual([])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
