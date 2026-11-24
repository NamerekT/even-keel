import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const OWNER = 'a1000000-0000-4000-8000-000000000001'

it("step 81 keeps the host name of a device token's passkey, none before it (BTN-1631)", { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 79))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(81))
    expect(await databaseVersion(frozen)).toBe(81)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 81, 81)
    // Read as step 81 left the table: `tokensOf` follows the latest schema (step 82's `invite_id`).
    expect((await passkeyHosts(frozen)).map((token) => [token.device, token.passkey_host])).toEqual([
      ['Firefox on Linux', null],
      ['Safari on iPhone', 'hub.example.com'],
    ])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(80))
    await upgraded.exec(STEPS[78]!)
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
    expect((await passkeyHosts(upgraded)).map((token) => token.passkey_host)).toEqual([null, null])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

async function passkeyHosts(db: PGlite) {
  const { rows } = await db.query<{ device: string; passkey_host: string | null }>(
    'select device, passkey_host from access_tokens where person_id = $1 order by created_at, id',
    [OWNER],
  )
  return rows
}
