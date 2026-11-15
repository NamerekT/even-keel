import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto'

/** The hub's certificate for machines: self-signed, pinned by its SHA-256 in every connection token. */
export interface HubCertificate {
  /** PEM. */
  cert: string
  /** PEM, PKCS#8. */
  key: string
  /** SHA-256 of the certificate's DER, lowercase hex. */
  fingerprint: string
}

const YEARS = 25
const COMMON_NAME = 'Even Keel hub'
const ECDSA_WITH_SHA256 = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]
const COMMON_NAME_OID = [0x55, 0x04, 0x03]

function der(tag: number, ...parts: Uint8Array[]): Buffer {
  const content = Buffer.concat(parts)
  const size = content.length
  const head = size < 0x80 ? [size] : size < 0x100 ? [0x81, size] : [0x82, size >> 8, size & 0xff]
  return Buffer.concat([Buffer.from([tag, ...head]), content])
}

const sequence = (...parts: Uint8Array[]) => der(0x30, ...parts)
const oid = (bytes: number[]) => der(0x06, Buffer.from(bytes))

/** UTCTime up to 2049, GeneralizedTime from 2050, as RFC 5280 asks. */
function time(date: Date): Buffer {
  const digits = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'
  return date.getUTCFullYear() < 2050 ? der(0x17, Buffer.from(digits.slice(2), 'ascii')) : der(0x18, Buffer.from(digits, 'ascii'))
}

/** The SHA-256 of a certificate's DER, as the connection token carries it. */
export const fingerprintOf = (raw: Uint8Array): string => createHash('sha256').update(raw).digest('hex')

/**
 * A new key pair (ECDSA P-256) and its self-signed certificate, built by hand: the project takes no dependency for
 * it. Nobody verifies its chain or its name: a machine compares the fingerprint.
 */
export function createCertificate(now: Date = new Date()): HubCertificate {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const serial = randomBytes(16)
  serial[0] = (serial[0]! & 0x7f) | 0x40
  const algorithm = sequence(oid(ECDSA_WITH_SHA256))
  const name = sequence(der(0x31, sequence(oid(COMMON_NAME_OID), der(0x0c, Buffer.from(COMMON_NAME, 'utf8')))))
  const until = new Date(now)
  until.setUTCFullYear(until.getUTCFullYear() + YEARS)
  const body = sequence(
    der(0x02, serial),
    algorithm,
    name,
    sequence(time(new Date(now.getTime() - 86_400_000)), time(until)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
  )
  const signature = sign('sha256', body, privateKey)
  const raw = sequence(body, algorithm, der(0x03, Buffer.from([0]), signature))
  return {
    cert: new X509Certificate(raw).toString(),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fingerprint: fingerprintOf(raw),
  }
}
