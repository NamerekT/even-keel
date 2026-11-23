import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionRecord } from '../sessions/agents.js'
import { FolderListings, LISTING_MAX_AGE_MS } from './listing.js'

let dir: string
let now: number
let asked: number
let listings: FolderListings

const ask = () => {
  asked++
  return Promise.resolve(`[${asked}]`)
}
const job = (id: string, state: Record<string, unknown>) =>
  mkdir(join(dir, 'jobs', id), { recursive: true }).then(() => writeFile(join(dir, 'jobs', id, 'state.json'), JSON.stringify(state)))
const roster = (workers: string[]) =>
  mkdir(join(dir, 'daemon'), { recursive: true }).then(() =>
    writeFile(join(dir, 'daemon', 'roster.json'), JSON.stringify({ supervisorPid: 1, updatedAt: 1, workers: Object.fromEntries(workers.map((id) => [id, { pid: 2 }])) })),
  )
const list = (records: SessionRecord[] = [], fresh = false, bin = 'claude') => listings.stdout(dir, bin, records, fresh, ask)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'even-keel-listing-'))
  now = 1_000_000
  asked = 0
  listings = new FolderListings(() => now)
  await job('aaaa1111', { state: 'working', detail: 'Running npm test', tokens: 10, sessionId: 'session-1' })
})

afterEach(() => rm(dir, { recursive: true, force: true }))

describe('FolderListings', () => {
  it('asks the CLI once while nothing it prints from changes', async () => {
    expect(await list()).toBe('[1]')
    expect(await list()).toBe('[1]')
    expect(asked).toBe(1)
  })

  it('does not ask again when a turn only moves the volatile fields', async () => {
    await list()
    await job('aaaa1111', { state: 'working', detail: 'Running npm run typecheck', tokens: 4000, updatedAt: 'later', sessionId: 'session-1' })
    await list()
    expect(asked).toBe(1)
  })

  it('asks again when a job changes state, appears or goes', async () => {
    await list()
    await job('aaaa1111', { state: 'blocked', detail: 'Running npm test', tokens: 10, sessionId: 'session-1' })
    await list()
    await job('bbbb2222', { state: 'working' })
    await list()
    await rm(join(dir, 'jobs', 'bbbb2222'), { recursive: true })
    await list()
    expect(asked).toBe(4)
  })

  it('asks again when a fresh state.json is rewritten within one mtime tick at the same size', async () => {
    const file = join(dir, 'jobs', 'aaaa1111', 'state.json')
    const tick = new Date()
    await utimes(file, tick, tick)
    await list()
    await job('aaaa1111', { state: 'blocked', detail: 'Running npm test', tokens: 10, sessionId: 'session-1' })
    await utimes(file, tick, tick)
    await list()
    expect(asked).toBe(2)
  })

  it('asks again when a fresh roster is rewritten within one mtime tick at the same size', async () => {
    const file = join(dir, 'daemon', 'roster.json')
    const tick = new Date()
    await roster(['aaaa1111'])
    await utimes(file, tick, tick)
    await list()
    await roster(['bbbb2222'])
    await utimes(file, tick, tick)
    await list()
    expect(asked).toBe(2)
  })

  it('trusts the stamp of a file written long before it was read', async () => {
    const file = join(dir, 'jobs', 'aaaa1111', 'state.json')
    const old = new Date(Date.now() - 60_000)
    await utimes(file, old, old)
    await list()
    await job('aaaa1111', { state: 'blocked', detail: 'Running npm test', tokens: 10, sessionId: 'session-1' })
    await utimes(file, old, old)
    await list()
    expect(asked).toBe(1)
  })

  it('asks again when a live session record changes or its process ends', async () => {
    const record: SessionRecord = { pid: 10, sessionId: 'session-1', status: 'busy' }
    await list([record])
    await list([{ ...record, status: 'idle' }])
    await list([])
    expect(asked).toBe(3)
  })

  it('asks again for another CLI binary, a fresh listing and after the longest age', async () => {
    await list()
    await list([], false, 'claude-2')
    await list([], true, 'claude-2')
    expect(await list([], false, 'claude-2')).toBe('[3]')
    now += LISTING_MAX_AGE_MS
    await list([], false, 'claude-2')
    expect(asked).toBe(4)
  })

  it('keeps a folder with no jobs yet, and asks every time when the jobs cannot be listed', async () => {
    await rm(join(dir, 'jobs'), { recursive: true })
    await list()
    await list()
    expect(asked).toBe(1)
    await writeFile(join(dir, 'jobs'), 'not a folder')
    await list()
    await list()
    expect(asked).toBe(3)
  })

  it('looks at a finished job again only once the daemon holds it, as a resume makes it', async () => {
    await job('aaaa1111', { state: 'done', sessionId: 'session-1' })
    await list()
    await job('aaaa1111', { state: 'done', sessionId: 'session-1', name: 'renamed' })
    await list()
    expect(asked).toBe(1)
    await roster(['aaaa1111'])
    await list()
    await job('aaaa1111', { state: 'working', sessionId: 'session-2' })
    await list()
    expect(asked).toBe(3)
  })

  it('looks at every job while the roster cannot be parsed', async () => {
    await job('aaaa1111', { state: 'done', sessionId: 'session-1' })
    await mkdir(join(dir, 'daemon'))
    await writeFile(join(dir, 'daemon', 'roster.json'), '{')
    await list()
    await job('aaaa1111', { state: 'working', sessionId: 'session-2' })
    await list()
    expect(asked).toBe(2)
  })

  it('asks again after a failed answer', async () => {
    await expect(listings.stdout(dir, 'claude', [], false, () => Promise.reject(new Error('timed out')))).rejects.toThrow('timed out')
    expect(await list()).toBe('[1]')
  })
})
