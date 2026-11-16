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
