import { describe, expect, it } from 'vitest'
import { sdkVersionOf } from './release.js'

describe('sdkVersionOf', () => {
  it('pairs the CLI 2.1.N with the SDK 0.3.N', () => {
    expect(sdkVersionOf('2.1.306')).toBe('0.3.306')
    expect(sdkVersionOf(' 2.1.7\n')).toBe('0.3.7')
  })

  it('knows no SDK for another line of the CLI', () => {
    expect(sdkVersionOf('2.2.0')).toBeNull()
    expect(sdkVersionOf('2.1.306-beta')).toBeNull()
    expect(sdkVersionOf('')).toBeNull()
  })
})
