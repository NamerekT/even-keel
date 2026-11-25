import { expect, it } from 'vitest'
import { linkPlaceOf, loopbackName, withTyped } from './inviteOrigin.js'

const TAILNET = { origin: 'https://hub.example.ts.net:8443', seenAt: '2026-11-25T08:00:00.000Z' }
const LAN = { origin: 'http://192.0.2.10:4747', seenAt: '2026-11-24T19:00:00.000Z' }
const LOCAL = { origin: 'http://localhost:4747', hostname: 'localhost' }

it('links a page opened by an outside name to itself, whatever the hub knows', () => {
  expect(linkPlaceOf({ origin: 'http://192.0.2.10:4747', hostname: '192.0.2.10' }, [TAILNET])).toEqual({ kind: 'page', origin: 'http://192.0.2.10:4747' })
})

it('never links a loopback page to localhost: the addresses known, the last seen first, or none and it asks', () => {
  expect(linkPlaceOf(LOCAL, [])).toEqual({ kind: 'ask' })
  expect(linkPlaceOf(LOCAL, [LAN])).toEqual({ kind: 'known', origins: [LAN.origin] })
  expect(linkPlaceOf(LOCAL, [LAN, TAILNET])).toEqual({ kind: 'known', origins: [TAILNET.origin, LAN.origin] })
  for (const hostname of ['127.0.0.1', '[::1]', 'hub.localhost']) expect(linkPlaceOf({ origin: `http://${hostname}`, hostname }, []).kind).toBe('ask')
})

it('takes a typed address as the last one seen', () => {
  const typed = { origin: 'https://phone-way.example.net', seenAt: '2026-11-25T09:00:00.000Z' }
  const known = withTyped([TAILNET, LAN], [typed, TAILNET, LAN])
  expect(linkPlaceOf(LOCAL, known)).toEqual({ kind: 'known', origins: [typed.origin, TAILNET.origin, LAN.origin] })
  expect(loopbackName('hub.example.ts.net')).toBe(false)
})
