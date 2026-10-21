import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const LEFTOVER = /^\.oauth_refresh\.lock\.owner\.tmp\.[0-9a-f]{8}$/
const LEFTOVER_AGE_MS = 60 * 60_000

/**
 * Removes the `.oauth_refresh.lock.owner.tmp.*` files the CLI leaves in an account folder when writing the owner of
 * its token renewal lock fails half-way (EKR-15): the write takes milliseconds, so one an hour old is abandoned.
 * Returns how many went.
 */
export async function sweepRefreshLeftovers(dir: string, now: number, maxAgeMs = LEFTOVER_AGE_MS): Promise<number> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names.filter((each) => LEFTOVER.test(each))) {
    const file = join(dir, name)
    try {
      if (now - (await stat(file)).mtimeMs < maxAgeMs) continue
      await unlink(file)
      removed++
    } catch {
      // Gone already or held: the next sweep tries again.
    }
  }
  return removed
}
