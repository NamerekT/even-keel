import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { tokensOf } from '../access/store.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const OWNER = 'a1000000-0000-4000-8000-000000000001'

it('step 82 keeps the invitations of new devices and the invitation a token came in by, none before it (BTN-1655)', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 80))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(82))
    expect(await databaseVersion(frozen)).toBe(82)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 82, 82)
    expect((await tokensOf(frozen, OWNER)).map((token) => [token.device, token.inviteId])).toEqual([
      ['Firefox on Linux', null],
      ['Safari on iPhone', null],
      ['Chrome on Android', 'i1000000-0000-4000-8000-000000000001'],
    ])
    const { rows } = await frozen.query<{ state: string }>('select state from device_invites order by created_at')
    expect(rows.map((row) => row.state)).toEqual(['used', 'declined', 'waiting'])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(81))
    await upgraded.exec(STEPS[79]!)
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
    expect((await tokensOf(upgraded, OWNER)).map((token) => token.inviteId)).toEqual([null, null])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
