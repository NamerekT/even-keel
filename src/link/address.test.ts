import { describe, expect, it } from 'vitest'
import { hubUrlOf, MACHINES_PORT, machinesPortOf, writtenAddressOf } from './address.js'

describe("the hub's address for machines", () => {
  it('makes an https origin with the machines port, unless the address names its own', () => {
    expect(hubUrlOf(' Hub.Example.com ', 4749)).toBe('https://hub.example.com:4749')
    expect(hubUrlOf('hub.example.com:8443', 4749)).toBe('https://hub.example.com:8443')
    expect(hubUrlOf('192.168.1.20', 4749)).toBe('https://192.168.1.20:4749')
    expect(hubUrlOf('[fd7a::7]', 4749)).toBe('https://[fd7a::7]:4749')
  })

  it('keeps 443 the address names, which a URL drops as the default (BTN-1620)', () => {
    expect(hubUrlOf('hub.example.com:443', 4749)).toBe('https://hub.example.com')
    expect(hubUrlOf('[fd7a::7]:443', 4749)).toBe('https://[fd7a::7]')
  })

  it('writes the address back as join takes it: the same URL comes of it', () => {
    for (const [hub, written] of [
      ['https://hub.example.com:4749', 'hub.example.com'],
      ['https://hub.example.com', 'hub.example.com:443'],
      ['https://hub.example.com:5000', 'hub.example.com:5000'],
      ['https://[fd7a::7]:4749', '[fd7a::7]'],
    ] as const) {
      expect(writtenAddressOf(hub)).toBe(written)
      expect(hubUrlOf(written, MACHINES_PORT)).toBe(hub)
    }
  })

  it('refuses what is no host: a scheme, a path, credentials, spaces or nothing', () => {
    for (const address of ['', '   ', 'https://hub.example.com', 'hub.example.com/link', 'john@hub.example.com', 'hub example.com', 'hub.example.com?x', ':4749']) {
      expect(hubUrlOf(address, 4749), address).toBeUndefined()
    }
  })

  it('takes the port from the environment, the default for anything that is no port', () => {
    expect(machinesPortOf({})).toBe(MACHINES_PORT)
    expect(machinesPortOf({ EVEN_KEEL_MACHINES_PORT: '5000' })).toBe(5000)
    expect(machinesPortOf({ EVEN_KEEL_MACHINES_PORT: 'many' })).toBe(MACHINES_PORT)
    expect(machinesPortOf({ EVEN_KEEL_MACHINES_PORT: '70000' })).toBe(MACHINES_PORT)
  })
})
