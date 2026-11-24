import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers'

const sha256 = (data: Uint8Array | string) => new Uint8Array(createHash('sha256').update(data).digest())
const b64 = (data: Uint8Array | string) => isoBase64URL.fromBuffer(typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data))

const UP = 0x01
const UV = 0x04
const AT = 0x40

/**
 * A software authenticator for tests: one ES256 passkey, attestation `none`, made and used as a browser's platform
 * authenticator would, on whatever origin and RP ID it is told.
 */
export class FakeAuthenticator {
  readonly id = new Uint8Array(randomBytes(16))
  private readonly key: { privateKey: KeyObject; publicKey: KeyObject } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  private counter = 0
  private user = ''

  get credentialId(): string {
    return b64(this.id)
  }

  create(options: PublicKeyCredentialCreationOptionsJSON, origin: string, rpId = options.rp.id!): RegistrationResponseJSON {
    this.user = options.user.id
    const jwk = this.key.publicKey.export({ format: 'jwk' })
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x!)],
      [-3, isoBase64URL.toBuffer(jwk.y!)],
    ])
    const coseBytes = isoCBOR.encode(cose)
    const idLength = new Uint8Array([this.id.length >> 8, this.id.length & 0xff])
    const authData = concat(this.head(rpId, UP | UV | AT), new Uint8Array(16), idLength, this.id, coseBytes)
    const attestation = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as never)
    const clientData = JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false })
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      response: { clientDataJSON: b64(clientData), attestationObject: b64(attestation), transports: ['internal'] },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  get(options: PublicKeyCredentialRequestOptionsJSON, origin: string, rpId = options.rpId!): AuthenticationResponseJSON {
    this.counter += 1
    const authData = this.head(rpId, UP | UV)
    const clientData = JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false })
    const signature = sign('sha256', concat(authData, sha256(clientData)), this.key.privateKey)
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(new Uint8Array(signature)), userHandle: this.user },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  private head(rpId: string, flags: number): Uint8Array {
    const count = new Uint8Array(4)
    new DataView(count.buffer).setUint32(0, this.counter)
    return concat(sha256(rpId), new Uint8Array([flags]), count)
  }
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const whole = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    whole.set(part, at)
    at += part.length
  }
  return whole
}
