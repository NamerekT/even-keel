import { describe, expect, it } from 'vitest'
import { isNewer } from './version.js'

describe('isNewer', () => {
  it('compares dotted numbers as numbers', () => {
    expect(isNewer('0.5.2', '0.5.1')).toBe(true)
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('1.0', '0.99.1')).toBe(true)
    expect(isNewer('0.5.1', '0.5.2')).toBe(false)
  })

  it('takes the same version, with or without a v or trailing zeros, as not newer', () => {
    expect(isNewer('0.5.1', '0.5.1')).toBe(false)
    expect(isNewer('v1.2.0', '1.2')).toBe(false)
  })

  it('puts a pre-release before its release', () => {
    expect(isNewer('1.0.0', '1.0.0-beta.2')).toBe(true)
    expect(isNewer('1.0.0-beta.2', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0-beta.3', '1.0.0-beta.2')).toBe(true)
  })

  it('ignores build metadata', () => {
    expect(isNewer('1.0.0+build.7', '1.0.0')).toBe(false)
  })

  it('takes any known version as newer than an install without one, and no version as never newer', () => {
    expect(isNewer('0.1.0', null)).toBe(true)
    expect(isNewer(null, '0.1.0')).toBe(false)
    expect(isNewer(null, null)).toBe(false)
  })

  it('takes a version that does not parse as newer only when it differs', () => {
    expect(isNewer('nightly', '1.0.0')).toBe(true)
    expect(isNewer('nightly', 'nightly')).toBe(false)
  })
})
