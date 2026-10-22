import { describe, expect, it } from 'vitest'
import { fixEpisodeId, fixNameOf, liveFixId, projectOfFix } from './fix.js'

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

  it('give a live fix the open episode, otherwise the next one', () => {
    expect(liveFixId('ABC-FIX', [{ id: 'ABC-FIX.1', end: 'x' }])).toBe('ABC-FIX.2')
    expect(liveFixId('ABC-FIX', [{ id: 'ABC-FIX.1', end: null }])).toBe('ABC-FIX.1')
  })
})
