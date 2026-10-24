import { describe, expect, it } from 'vitest'
import { carryNameOf, fixEpisodeId, fixNameOf, fixTaskOf, isCarryName, isOwnName, liveFixId, projectOfCarry, projectOfFix } from './fix.js'

describe('fix names', () => {
  const keys = { 'f00d-1': 'ABC', 'beef-2': 'ABC', 'cafe-3': 'XYZ' }

  it('run a fix under the key of the first project of a key, and under the key and the start of the id after it (BTN-271)', () => {
    expect(Object.keys(keys).map((project) => fixNameOf(keys, project))).toEqual(['ABC-FIX', 'ABC_BEEF-FIX', 'XYZ-FIX'])
  })

  it('find the project of a fix by its name or the id of one of its episodes', () => {
    expect(projectOfFix(keys, 'ABC-FIX')).toBe('f00d-1')
    expect(projectOfFix(keys, fixEpisodeId('ABC_BEEF-FIX', 3))).toBe('beef-2')
    expect(projectOfFix(keys, 'QQ-FIX')).toBeUndefined()
  })

  it('run the carry of a release project under its fix stem, and tell it from a fix (BTN-369)', () => {
    expect(Object.keys(keys).map((project) => carryNameOf(keys, project))).toEqual(['ABC-CARRY', 'ABC_BEEF-CARRY', 'XYZ-CARRY'])
    expect([isCarryName('ABC-CARRY'), isCarryName('ABC-CARRY.2'), isCarryName('ABC-FIX'), isCarryName('ABC-12')]).toEqual([true, true, false, false])
    expect([isOwnName('ABC-CARRY.2'), isOwnName('ABC-FIX'), isOwnName('ABC-12')]).toEqual([true, true, false])
    expect([fixTaskOf('ABC-CARRY.2'), fixTaskOf('ABC-FIX.3'), fixTaskOf('ABC-12')]).toEqual(['ABC-CARRY', 'ABC-FIX', 'ABC-12'])
  })

  it('find the project a carry runs in: the one its release project merges into', () => {
    const into = (from: string) => (from === 'beef-2' ? 'f00d-1' : undefined)
    expect(projectOfCarry(keys, into, fixEpisodeId('ABC_BEEF-CARRY', 2))).toBe('f00d-1')
    expect(projectOfCarry(keys, into, 'XYZ-CARRY')).toBeUndefined()
  })

  it('give a live fix the open episode, otherwise the next one', () => {
    expect(liveFixId('ABC-FIX', [{ id: 'ABC-FIX.1', end: 'x' }])).toBe('ABC-FIX.2')
    expect(liveFixId('ABC-FIX', [{ id: 'ABC-FIX.1', end: null }])).toBe('ABC-FIX.1')
  })
})
