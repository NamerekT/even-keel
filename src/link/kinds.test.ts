import { describe, expect, it } from 'vitest'
import { kindOf } from './kinds.js'

describe('what a machine icon is told of a machine', () => {
  it('takes the platform out of the system it reported', () => {
    expect(kindOf({ os: 'win32 10.0.26200' })).toEqual({ platform: 'win32' })
    expect(kindOf({ os: 'linux 6.8.0', container: true })).toEqual({ platform: 'linux', container: true })
  })

  it('is empty for a machine that told nothing yet', () => {
    expect(kindOf(null)).toEqual({})
    expect(kindOf({ os: '' })).toEqual({})
  })
})
