import { describe, expect, it } from 'vitest'
import { errorReason } from './error-reason.js'

describe('errorReason', () => {
  it('redacts overlapping values and their URL encodings, ignoring missing values', () => {
    const secret = 'fake value/+&'
    const encoded = encodeURIComponent(secret)
    const form = new URLSearchParams({ v: secret }).toString().slice(2)
    expect(errorReason(`failed ${secret} ${encoded} ${form} fake-long fake`, [null, undefined, '', 'fake', 'fake-long', secret]))
      .toBe('failed [redacted] [redacted] [redacted] [redacted] [redacted]')
  })

  it('keeps the OAuth authentication patterns, normalization and limit', () => {
    expect(errorReason('Bearer hidden, Basic hidden; code=hidden&state=hidden access_token=hidden refresh_token=hidden client_secret=hidden code_verifier=hidden'))
      .toBe('Bearer [redacted], Basic [redacted]; code=[redacted]&state=[redacted] access_token=[redacted] refresh_token=[redacted] client_secret=[redacted] code_verifier=[redacted]')
    expect(errorReason(' a\n\u0000b ')).toBe('a b')
    expect(errorReason('x'.repeat(600))).toHaveLength(500)
    expect(errorReason(new TypeError(''))).toBe('TypeError')
    expect(errorReason(null)).toBe('Unknown error')
    expect(errorReason('')).toBe('')
  })
})
