import { expect, it } from 'vitest'
import { cancelled } from './passkey.js'

it('takes a closed passkey dialog for a cancel, bare or wrapped by the library, and nothing else (BTN-1619)', () => {
  const closed = Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' })
  const wrapped = Object.assign(new Error('Authentication ceremony was sent an abort signal'), { name: 'WebAuthnError', cause: closed })
  expect(cancelled(closed)).toBe(true)
  expect(cancelled(wrapped)).toBe(true)
  expect(cancelled({ name: 'NotAllowedError' })).toBe(true)
  expect(cancelled(new Error('auth/passkey answered 400'))).toBe(false)
  expect(cancelled(Object.assign(new Error('x'), { name: 'SecurityError' }))).toBe(false)
  expect(cancelled(null)).toBe(false)
  expect(cancelled('NotAllowedError')).toBe(false)
})
