import { access, readdir } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { pathKey } from '../paths.js'

/** Where a Codex session's rollout is: `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`. */
export interface Rollout {
  id: string
  file: string
}

const ROLLOUT = /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

/**
 * Each account folder's rollouts met so far, by session id (BTN-1477). A rollout never moves, so its path holds while
 * the file exists; a whole walk replaces the folder's map, which forgets the deleted ones.
 */
const known = new Map<string, Map<string, string>>()

/** The rollout files of a Codex folder, newest first; `limit` ends the walk once that many are found. */
export async function rolloutFiles(home: string, limit = Infinity): Promise<Rollout[]> {
  return walk(home, (found) => found.length >= limit)
}

/** A session's rollout: the path met before while its file is there, else a walk newest first until it is found. */
export async function rolloutFile(home: string, sessionId: string): Promise<string | undefined> {
  const cache = remembered(home)
  const cached = cache.get(sessionId)
  if (cached !== undefined && (await access(cached).then(() => true, () => false))) return cached
  if (cache.get(sessionId) === cached) cache.delete(sessionId)
  return (await walk(home, (found) => found.at(-1)?.id === sessionId)).find((rollout) => rollout.id === sessionId)?.file
}

async function walk(home: string, enough: (found: Rollout[]) => boolean): Promise<Rollout[]> {
  const found: Rollout[] = []
  const root = join(home, 'sessions')
  const stopped = async (): Promise<boolean> => {
    for (const year of await newestFirst(root)) {
      for (const month of await newestFirst(`${root}${sep}${year}`)) {
        for (const day of await newestFirst(`${root}${sep}${year}${sep}${month}`)) {
          const dir = `${root}${sep}${year}${sep}${month}${sep}${day}`
          for (const name of await newestFirst(dir)) {
            const id = ROLLOUT.exec(name)?.[1]
            if (id === undefined) continue
            found.push({ id, file: `${dir}${sep}${name}` })
            if (enough(found)) return true
          }
        }
      }
    }
    return false
  }
  const partial = await stopped()
  const cache = partial ? remembered(home) : new Map<string, string>()
  for (const { id, file } of found.toReversed()) cache.set(id, file)
  if (!partial) known.set(pathKey(home), cache)
  return found
}

function remembered(home: string): Map<string, string> {
  const key = pathKey(home)
  let cache = known.get(key)
  if (cache === undefined) known.set(key, (cache = new Map()))
  return cache
}

async function newestFirst(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [])).sort().reverse()
}
