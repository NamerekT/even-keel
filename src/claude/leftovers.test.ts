import { existsSync } from 'node:fs'
import { mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sweepRefreshLeftovers } from './leftovers.js'

const HOUR = 60 * 60_000

describe('sweepRefreshLeftovers', () => {
  it('removes only the refresh lock owner files left over for an hour', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'even-keel-leftovers-'))
    const now = Date.now()
    const files = {
      old: '.oauth_refresh.lock.owner.tmp.032afe83',
      fresh: '.oauth_refresh.lock.owner.tmp.041d8c99',
      owner: '.oauth_refresh.lock.owner',
      other: '.credentials.json.tmp.06f8d8ce',
      odd: '.oauth_refresh.lock.owner.tmp.nothex12',
    }
    for (const name of Object.values(files)) {
      await writeFile(join(dir, name), '{}')
      if (name !== files.fresh) await utimes(join(dir, name), new Date(now - 2 * HOUR), new Date(now - 2 * HOUR))
    }
    expect(await sweepRefreshLeftovers(dir, now)).toBe(1)
    expect(existsSync(join(dir, files.old))).toBe(false)
    for (const name of [files.fresh, files.owner, files.other, files.odd]) expect(existsSync(join(dir, name))).toBe(true)
  })

  it('takes a missing folder as empty', async () => {
    expect(await sweepRefreshLeftovers(join(tmpdir(), 'even-keel-no-such-folder'), Date.now())).toBe(0)
  })
})
