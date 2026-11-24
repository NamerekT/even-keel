import { randomBytes, scrypt } from 'node:crypto'

/** Crockford's base32: no I, L, O or U, so a code read off a terminal is typed back without a doubt. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const SYMBOLS = 6

/**
 * Slow on purpose (about a tenth of a second, 32 MB): a man in the middle sees the machine's number and could try
 * numbers of his own until the hub shows the code the machine shows. With 30 bits of code that is a billion tries,
 * years at this cost, while a request lives ten minutes.
 */
const COST = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

/** A machine's number of a join request: 128 random bits, hex. */
export const newNonce = (): string => randomBytes(16).toString('hex')

export const isNonce = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)

/**
 * The code a person compares on the machine's terminal and the hub's page (BTN-1620), such as `K7Q-4M2`: of the
 * SHA-256 of the certificate the machine saw and the machine's number. A hub behind a certificate of a public
 * authority, which the machine verified as any HTTPS one, has the empty fingerprint: the code is of the number alone.
 */
export function joinCodeOf(fingerprint: string, nonce: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(`even-keel join ${fingerprint}`, nonce, 4, COST, (error, key) => {
      if (error !== null) return reject(error)
      const bits = key.readUInt32BE(0) >>> 2
      let code = ''
      for (let index = SYMBOLS - 1; index >= 0; index--) code += ALPHABET[(bits >>> (index * 5)) & 31]
      resolve(`${code.slice(0, 3)}-${code.slice(3)}`)
    })
  })
}
