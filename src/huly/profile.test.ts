import { describe, expect, it } from 'vitest'
import { refusedBy } from './profile.js'

describe('refusedBy', () => {
  it('a platform status or the client\'s own login texts are a refusal', () => {
    expect(refusedBy(Object.assign(new Error('Unauthorized'), { status: { code: 'platform:status:Unauthorized' } }))).toBe(true)
    expect(refusedBy(new Error('Login failed'))).toBe(true)
    expect(refusedBy(new Error('Workspace not found'))).toBe(true)
    expect(refusedBy(new Error('Workspace example not found'))).toBe(true)
  })

  it('a network failure is not', () => {
    expect(refusedBy(new Error('fetch failed'))).toBe(false)
    expect(refusedBy(new Error('huly: no answer in 5000 ms'))).toBe(false)
    expect(refusedBy(null)).toBe(false)
  })
})
