import { expect, it } from 'vitest'
import { cancelled, ceremony, NO_DIALOG_MS, openedByIp, type PageWatch } from './passkey.js'

it('tells a page opened by an IP address, v4 or v6, from one opened by a name (BTN-1632)', () => {
  for (const ip of ['127.0.0.1', '192.168.1.20', '[::1]', '::1', '[fe80::1]']) expect(openedByIp(ip)).toBe(true)
  for (const name of ['localhost', 'hub.example.com', 'pc.tail1234.ts.net']) expect(openedByIp(name)).toBe(false)
})

const refused = () => Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' })

/** A page whose clock moves `took` ms during the ceremony and whose focus was lost or not. */
function page(took: number, left = false): PageWatch & { stopped: boolean } {
  let at = 0
  const watch = {
    stopped: false,
    now: () => {
      const now = at
      at += took
      return now
    },
    left: () => left,
    stop: () => {
      watch.stopped = true
    },
  }
  return watch
}

it('takes a refusal with no dialog — fast, the page never losing focus — for a browser without passkeys (BTN-1630)', async () => {
  const watch = page(40)
  await expect(ceremony(() => Promise.reject(refused()), watch)).resolves.toEqual({ refused: 'unsupported' })
  expect(watch.stopped).toBe(true)
  await expect(ceremony(() => Promise.reject(refused()), page(NO_DIALOG_MS - 1))).resolves.toEqual({ refused: 'unsupported' })
})

it('takes a slow refusal, or one after the page lost focus, for a person closing the dialog (BTN-1630)', async () => {
  await expect(ceremony(() => Promise.reject(refused()), page(NO_DIALOG_MS))).resolves.toEqual({ refused: 'cancelled' })
  await expect(ceremony(() => Promise.reject(refused()), page(300, true))).resolves.toEqual({ refused: 'cancelled' })
})

it('gives the response of a ceremony that passed and throws any error but a refusal (BTN-1630)', async () => {
  await expect(ceremony(() => Promise.resolve('signed'), page(10))).resolves.toEqual({ response: 'signed' })
  const watch = page(10)
  await expect(ceremony(() => Promise.reject(new Error('boom')), watch)).rejects.toThrow('boom')
  expect(watch.stopped).toBe(true)
})

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
