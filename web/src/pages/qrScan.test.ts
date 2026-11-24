import { encode } from 'uqr'
import { describe, expect, it } from 'vitest'
import { readQr } from './qrRead.js'
import { cameraHere, cameraProblem, scannedInvite } from './qrScan.js'

const ORIGIN = 'https://hub.example.ts.net'

describe('scannedInvite', () => {
  it('takes an invitation of this address', () => {
    expect(scannedInvite(`${ORIGIN}/invite#abc123`, ORIGIN)).toEqual({ at: 'invite', url: `${ORIGIN}/invite#abc123` })
    expect(scannedInvite(`  ${ORIGIN}/invite#abc123\n`, ORIGIN)).toEqual({ at: 'invite', url: `${ORIGIN}/invite#abc123` })
  })

  it('names the address of an invitation made elsewhere', () => {
    expect(scannedInvite('https://other.example.com:4747/invite#abc123', ORIGIN)).toEqual({ at: 'elsewhere', host: 'other.example.com:4747' })
    expect(scannedInvite('http://hub.example.ts.net/invite#abc123', ORIGIN)).toEqual({ at: 'elsewhere', host: 'hub.example.ts.net' })
  })

  it('refuses whatever is no invitation', () => {
    for (const text of ['hello', `${ORIGIN}/`, `${ORIGIN}/invite`, `${ORIGIN}/invite#`, `${ORIGIN}/p/ABC#abc`, 'javascript:alert(1)//invite#x', 'ftp://hub.example.ts.net/invite#x'])
      expect(scannedInvite(text, ORIGIN)).toEqual({ at: 'other' })
  })
})

describe('cameraHere', () => {
  const devices = (kinds: string[]) => async () => kinds.map((kind) => ({ kind }))

  it('needs a secure page, getUserMedia and a camera among the devices', async () => {
    const media = { getUserMedia: () => undefined, enumerateDevices: devices(['audioinput', 'videoinput']) }
    expect(await cameraHere({ isSecureContext: true, navigator: { mediaDevices: media } })).toBe(true)
    expect(await cameraHere({ isSecureContext: false, navigator: { mediaDevices: media } })).toBe(false)
    expect(await cameraHere({ isSecureContext: true, navigator: {} })).toBe(false)
  })

  it('has no camera when the devices hold none or cannot be listed', async () => {
    expect(await cameraHere({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia: () => undefined, enumerateDevices: devices(['audioinput']) } } })).toBe(false)
    const broken = { getUserMedia: () => undefined, enumerateDevices: async () => Promise.reject(new Error('no')) }
    expect(await cameraHere({ isSecureContext: true, navigator: { mediaDevices: broken } })).toBe(false)
  })

  it('takes getUserMedia alone where the devices cannot be listed at all', async () => {
    expect(await cameraHere({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia: () => undefined } } })).toBe(true)
  })
})

describe('cameraProblem', () => {
  it('tells a refused camera from a missing one', () => {
    expect(cameraProblem(new DOMException('', 'NotAllowedError'))).toBe('blocked')
    expect(cameraProblem(new DOMException('', 'SecurityError'))).toBe('blocked')
    expect(cameraProblem(new DOMException('', 'NotFoundError'))).toBe('noCamera')
    expect(cameraProblem(new DOMException('', 'NotReadableError'))).toBe('noCamera')
    expect(cameraProblem(new Error('boom'))).toBe('failed')
  })
})

describe('readQr', () => {
  /** The page's own QR of `text` as the RGBA pixels of a camera frame, `scale` pixels a module. */
  const frame = (text: string, scale: number) => {
    const code = encode(text, { ecc: 'M', border: 4 })
    const side = code.size * scale
    const pixels = new Uint8ClampedArray(side * side * 4)
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        const value = code.data[Math.floor(y / scale)]?.[Math.floor(x / scale)] === true ? 0 : 255
        pixels.set([value, value, value, 255], (y * side + x) * 4)
      }
    return { data: pixels, width: side, height: side }
  }

  it('reads the QR of the invitation dialog without any network', () => {
    const link = `${ORIGIN}/invite#${'s'.repeat(43)}`
    expect(readQr(frame(link, 4))).toBe(link)
  })

  it('gives null for a frame with no code', () => {
    const side = 64
    expect(readQr({ data: new Uint8ClampedArray(side * side * 4).fill(255), width: side, height: side })).toBeNull()
  })
})
