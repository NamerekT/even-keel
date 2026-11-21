import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readLinkFile, writeLinkFile } from '../machine/join.js'
import { databaseDirOf, readOwner } from '../storage/owner.js'
import { CONTACT_EVERY_MS, contactKeeper, holdInstallation, joinedHub, machineOnly, waitForJoin } from './machine-process.js'

const LINK = { hub: 'https://hub.example.com:4750', machine: '11111111-1111-4111-8111-111111111111', root: '/home/example/projects', joinedAt: 1_000 }

describe('the process of a machine elsewhere', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const stateDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'even-keel-machine-'))
    dirs.push(dir)
    return dir
  }

  it('runs in the machine role only once join wrote the link file', () => {
    const dir = stateDir()
    expect(joinedHub(dir)).toBe(false)
    writeLinkFile(dir, LINK)
    expect(joinedHub(dir)).toBe(true)
  })

  it('waits for the join of a container meant for a machine instead of starting as a hub, saying so once', async () => {
    const dir = stateDir()
    const log: string[] = []
    let waits = 0
    const sleep = async () => {
      waits++
      if (waits === 3) writeLinkFile(dir, LINK)
    }
    await waitForJoin(dir, { sleep, log: (line) => void log.push(line) })
    expect(waits).toBe(3)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatch(/EVEN_KEEL_MACHINE.*even-keel join/)
    expect(machineOnly({ EVEN_KEEL_MACHINE: '1' })).toBe(true)
    expect(machineOnly({ EVEN_KEEL_MACHINE: '' })).toBe(false)
    expect(machineOnly({})).toBe(false)
  })

  it('holds the installation as the service does, so a second start and a join see it run, and lets it go', async () => {
    const dir = stateDir()
    const held = await holdInstallation(dir)
    if (!('release' in held)) throw new Error('not held')
    expect(await readOwner(databaseDirOf(dir))).toMatchObject({ pid: process.pid })
    expect(await holdInstallation(dir)).toMatchObject({ pid: process.pid })
    await held.release()
    expect(await readOwner(databaseDirOf(dir))).toBeNull()
  })

  it('writes the last contact when the link comes up, then at most once a minute', () => {
    const dir = stateDir()
    writeLinkFile(dir, LINK)
    let now = 10_000
    const keep = contactKeeper(dir, () => {}, () => now)
    keep(false, undefined)
    expect(readLinkFile(dir)?.contactAt).toBeUndefined()
    keep(true, 10_000)
    expect(readLinkFile(dir)?.contactAt).toBe(10_000)
    now = 20_000
    keep(true, 20_000)
    expect(readLinkFile(dir)?.contactAt).toBe(10_000)
    now = 10_000 + CONTACT_EVERY_MS
    keep(true, now)
    expect(readLinkFile(dir)?.contactAt).toBe(now)
    // A new connection is written at once.
    keep(false, now)
    now += 1_000
    keep(true, now)
    expect(readLinkFile(dir)?.contactAt).toBe(now)
  })
})
