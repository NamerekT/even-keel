import { describe, expect, it } from 'vitest'
import { isNonce, joinCodeOf, newNonce } from './join-code.js'

const FINGERPRINT = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

describe('the code of a join request (BTN-1620)', () => {
  it('is one code for one certificate and number, on the machine and the hub alike', async () => {
    const nonce = newNonce()
    expect(isNonce(nonce)).toBe(true)
    const code = await joinCodeOf(FINGERPRINT, nonce)
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/)
    expect(await joinCodeOf(FINGERPRINT, nonce)).toBe(code)
  })

  it('differs for another certificate, another number and a public certificate', async () => {
    const nonce = newNonce()
    const code = await joinCodeOf(FINGERPRINT, nonce)
    expect(await joinCodeOf(OTHER, nonce)).not.toBe(code)
    expect(await joinCodeOf('', nonce)).not.toBe(code)
    expect(await joinCodeOf(FINGERPRINT, newNonce())).not.toBe(code)
  })
})
