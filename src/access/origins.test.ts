import { expect, it } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { memoryDatabase } from '../storage/memory.js'
import { externalOrigin, ORIGIN_KEPT_MS, PageOrigins, typedOrigin } from './origins.js'

async function originsOf(start = '2026-11-25T08:00:00.000Z') {
  const db = await memoryDatabase()
  let now = new Date(start)
  const origins = await PageOrigins.load(db, { clock: () => now })
  return { db, origins, later: (ms: number) => (now = new Date(now.getTime() + ms)) }
}

const rowsOf = async (db: Awaited<ReturnType<typeof memoryDatabase>>) =>
  (await db.query<{ origin: string; seen_at: string }>('select origin, seen_at from page_origins order by origin')).rows

it('takes an origin by a name other than loopback, normalized, and none of this machine', () => {
  expect(externalOrigin('https://Hub.Example.ts.net:8443')).toBe('https://hub.example.ts.net:8443')
  expect(externalOrigin('https://hub.example.ts.net:443')).toBe('https://hub.example.ts.net')
  expect(externalOrigin('http://192.0.2.10:4747')).toBe('http://192.0.2.10:4747')
  expect(externalOrigin('http://[2001:db8::1]:4747')).toBe('http://[2001:db8::1]:4747')
  for (const local of ['http://localhost:4747', 'http://127.0.0.1:4747', 'http://127.1.2.3', 'http://[::1]:4747', 'http://app.localhost:4747', 'http://0.0.0.0:4747']) {
    expect(externalOrigin(local), local).toBeUndefined()
  }
  for (const other of [undefined, '', 'null', 'file:///c:/page.html', 'chrome-extension://abc', 'not an address']) expect(externalOrigin(other), other).toBeUndefined()
})

it('reads a typed address as the origin, https by default, and refuses loopback or no address', () => {
  expect(typedOrigin('  hub.example.ts.net:8443 ')).toBe('https://hub.example.ts.net:8443')
  expect(typedOrigin('https://hub.example.ts.net:8443/settings?x=1')).toBe('https://hub.example.ts.net:8443')
  expect(typedOrigin('http://192.0.2.10:4747/')).toBe('http://192.0.2.10:4747')
  const refusal = (typed: string) => {
    try {
      typedOrigin(typed)
    } catch (error) {
      return noticeOf(error).code
    }
    return 'taken'
  }
  expect(refusal('http://localhost:4747')).toBe('auth.inviteOriginLocal')
  expect(refusal('127.0.0.1:4747')).toBe('auth.inviteOriginLocal')
  for (const bad of ['', '   ', 'ftp://hub.example.com', 'https://', 'https://user:pass@hub.example.com', 'hub example']) expect(refusal(bad), bad).toBe('auth.inviteOriginBad')
  expect(() => typedOrigin('')).toThrow('https://name:port')
})

it('keeps the origins seen, the last one first, and writes each at most once a minute', async () => {
  const { db, origins, later } = await originsOf()
  origins.seen('https://hub.example.ts.net:8443')
  later(5_000)
  origins.seen('http://192.0.2.10:4747')
  later(5_000)
  origins.seen('https://hub.example.ts.net:8443')
  await origins.settled()
  expect(origins.list()).toEqual([
    { origin: 'https://hub.example.ts.net:8443', seenAt: '2026-11-25T08:00:10.000Z' },
    { origin: 'http://192.0.2.10:4747', seenAt: '2026-11-25T08:00:05.000Z' },
  ])
  expect(await rowsOf(db)).toEqual([
    { origin: 'http://192.0.2.10:4747', seen_at: '2026-11-25T08:00:05.000Z' },
    { origin: 'https://hub.example.ts.net:8443', seen_at: '2026-11-25T08:00:00.000Z' },
  ])
  later(60_000)
  origins.seen('https://hub.example.ts.net:8443')
  await origins.settled()
  expect((await rowsOf(db))[1]).toEqual({ origin: 'https://hub.example.ts.net:8443', seen_at: '2026-11-25T08:01:10.000Z' })
  expect((await PageOrigins.load(db)).list().map((each) => each.origin)).toEqual(['https://hub.example.ts.net:8443', 'http://192.0.2.10:4747'])
})

it('notes no loopback origin and no request without one', async () => {
  const { db, origins } = await originsOf()
  origins.seen('http://localhost:4747')
  origins.seen('http://127.0.0.1:4747')
  origins.seen(undefined)
  await origins.settled()
  expect(origins.list()).toEqual([])
  expect(await rowsOf(db)).toEqual([])
})

it('remembers a typed address at once as the last one, and leaves out those not seen for long', async () => {
  const { db, origins, later } = await originsOf()
  origins.seen('http://192.0.2.10:4747')
  await origins.settled()
  later(1_000)
  expect(await origins.remember('hub.example.ts.net:8443')).toBe('https://hub.example.ts.net:8443')
  expect(origins.list()[0]).toEqual({ origin: 'https://hub.example.ts.net:8443', seenAt: '2026-11-25T08:00:01.000Z' })
  expect(await rowsOf(db)).toContainEqual({ origin: 'https://hub.example.ts.net:8443', seen_at: '2026-11-25T08:00:01.000Z' })
  later(ORIGIN_KEPT_MS - 500)
  expect(origins.list().map((each) => each.origin)).toEqual(['https://hub.example.ts.net:8443'])
  await expect(origins.remember('localhost:4747')).rejects.toMatchObject({ notice: { code: 'auth.inviteOriginLocal' } })
})
