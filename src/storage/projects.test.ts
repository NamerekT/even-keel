import { describe, expect, it } from 'vitest'
import { rekeyed } from './projects.js'

describe('rekeyed', () => {
  it('renames a key whose id the new config gives another key, and passes the rest through', () => {
    const rename = rekeyed({ ABC: 'id-1', OLD: 'id-2', GONE: 'id-3' }, { ABC: 'id-1', NEW: 'id-2', XYZ: 'id-4' })
    expect(rename('OLD')).toBe('NEW')
    expect(rename('ABC')).toBe('ABC')
    expect(rename('GONE')).toBe('GONE')
    expect(rename('UNKNOWN')).toBe('UNKNOWN')
  })

  it('swaps two keys that trade their ids', () => {
    const rename = rekeyed({ ABC: 'id-1', XYZ: 'id-2' }, { XYZ: 'id-1', ABC: 'id-2' })
    expect([rename('ABC'), rename('XYZ')]).toEqual(['XYZ', 'ABC'])
  })
})
