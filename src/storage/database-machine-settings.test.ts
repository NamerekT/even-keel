import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { machineSettingsOf } from '../service/machine-settings.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

const SERVER = '88888888-8888-4888-8888-888888888888'
const LAPTOP = '99999999-9999-4999-8999-999999999999'

describe("step 60: a machine's own values in a project (BTN-994)", { timeout: 120_000 }, () => {
  it('adds the column of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 58))
    try {
      await frozen.exec(fixture(60))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 60, 60)
      expect(await machineSettingsOf(frozen, ABC, SERVER)).toEqual({
        beforeStart: ['npm ci'],
        afterGreen: ['npm run deploy:server'],
        servers: { files: { files: { command: '/opt/example/bin/files-mcp', args: ['/srv/example'] } } },
      })
      expect(await machineSettingsOf(frozen, ABC, LAPTOP)).toEqual({})
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('leaves the pools of the step before with nothing of their own', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(59))
      await db.exec(STEPS[57]!)
      expect(await machineSettingsOf(db, ABC, SERVER)).toEqual({})
      expect(await machineSettingsOf(db, ABC, LAPTOP)).toEqual({})
    } finally {
      await db.close()
    }
  })
})
