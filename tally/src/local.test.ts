import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { releaseOwn } from '../../src/storage/claim.js'
import { openLocalTally } from './local.js'

describe('local Tally database', { timeout: 120_000 }, () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tally-local-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const open = () => openLocalTally(dir, () => {})
  const ownerFile = () => join(dir, 'owner.json')

  it('is owned by one of two opens started together, the other refused', async () => {
    const [first, second] = await Promise.allSettled([open(), open()])
    const owners = [first, second].filter((result) => result.status === 'fulfilled')
    try {
      expect(owners).toHaveLength(1)
      expect([first, second].find((result) => result.status === 'rejected')?.reason).toMatchObject({ message: expect.stringMatching(/holds the local database/) })
    } finally {
      for (const owner of owners) await owner.value.close()
    }
    expect(existsSync(ownerFile())).toBe(false)
  })

  it('opens again once a terminated thread of this process had its claim released', async () => {
    writeFileSync(ownerFile(), JSON.stringify({ pid: process.pid, since: Date.now() }))
    await expect(open()).rejects.toThrow(/holds the local database/)
    releaseOwn(dir)
    await (await open()).close()
  })
})
