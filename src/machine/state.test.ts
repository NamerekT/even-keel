import { describe, expect, it } from 'vitest'
import { loadAccountSettings, saveAccountSettings } from '../account/settingsLayer.js'
import { openMachineDatabase } from '../link/machine-store.js'
import { loadSavedLimits, saveLimits } from '../limits/saved.js'
import type { RateLimits } from '../limits/model.js'
import { openDatabase } from '../storage/database.js'
import { setStateValue } from '../storage/service-state.js'
import { importMachineStores, machineValue } from './state.js'

const LIMITS = { fiveHour: { usedPercent: 40, resetsAt: '2026-11-16T20:00:00.000Z' } } as unknown as RateLimits
const SETTINGS = { written: { model: 'opus' }, own: { theme: 'dark' } }

describe('the machine stores', () => {
  it('imports the remaining stores even after the first import, without overwriting machine rows', async () => {
    const state = await openDatabase(undefined)
    const machine = await openMachineDatabase(undefined)
    try {
      await machine.query("insert into machine_state values ('stores.imported', '\"before\"')")
      await state.exec("insert into global_accounts values ('global'); insert into key_organizations values ('key', 'example-org', 'today'); insert into management_keys values ('key', 'fake-key', 'today'); insert into left_folders values ('/work', 'p', 'ABC-1', '/repo', 123); insert into context_windows values ('key', 'model', null, 'stamp', 200000, 123)")
      await setStateValue(state, 'cliCheck.history', { claude: { checked: 'example' } })
      await setStateValue(state, 'accounts.adoptLegacy', true)
      expect(await importMachineStores(machine, state, new Date())).toBe(true)
      for (const table of ['global_accounts', 'key_organizations', 'management_keys', 'left_folders', 'context_windows']) {
        expect((await machine.query(`select * from ${table}`)).rows).toEqual((await state.query(`select * from ${table}`)).rows)
      }
      expect((await machine.query("select value from machine_state where name = 'cliCheck.history'")).rows).toEqual([{ value: JSON.stringify({ claude: { checked: 'example' } }) }])
      await machine.exec('delete from global_accounts; delete from management_keys')
      expect(await importMachineStores(machine, state, new Date())).toBe(false)
      expect((await machine.query('select * from global_accounts')).rows).toEqual([])
      expect((await machine.query('select * from management_keys')).rows).toEqual([])
    } finally {
      await machine.close()
      await state.close()
    }
  })

  it('move from the state database into the machine database once, and are read there', async () => {
    const state = await openDatabase(undefined)
    const machine = await openMachineDatabase(undefined)
    try {
      await saveLimits(state, 'main', LIMITS)
      await saveAccountSettings(state, 'main', SETTINGS, new Date('2026-11-16T10:00:00Z'))
      await setStateValue(state, 'cli.downloaded', ['codex'])
      expect(await importMachineStores(machine, state, new Date('2026-11-16T11:00:00Z'))).toBe(true)
      expect(await loadSavedLimits(machine)).toEqual(new Map([['main', LIMITS]]))
      expect(await loadAccountSettings(machine)).toEqual(new Map([['main', SETTINGS]]))
      expect(await machineValue(machine, 'cli.downloaded')).toEqual(['codex'])
      // A later start keeps what the machine wrote since: the state database is read no more.
      await saveLimits(machine, 'main', undefined)
      await saveLimits(state, 'other', LIMITS)
      expect(await importMachineStores(machine, state, new Date())).toBe(false)
      expect(await loadSavedLimits(machine)).toEqual(new Map())
    } finally {
      await machine.close()
      await state.close()
    }
  })

  it('start empty on a new installation', async () => {
    const state = await openDatabase(undefined)
    const machine = await openMachineDatabase(undefined)
    try {
      expect(await importMachineStores(machine, state, new Date())).toBe(true)
      expect(await machineValue(machine, 'cli.downloaded')).toBeUndefined()
      expect(await loadSavedLimits(machine)).toEqual(new Map())
    } finally {
      await machine.close()
      await state.close()
    }
  })
})
