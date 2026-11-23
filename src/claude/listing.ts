import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionRecord } from '../sessions/agents.js'

/** The longest a folder's `claude agents` answer is kept while nothing it is read from changed. */
export const LISTING_MAX_AGE_MS = 30_000

/**
 * What a job's `state.json` changes on every step of a turn without changing what `claude agents` prints for it (CLI
 * 2.1.330). A field missing here only costs a call; one wrongly here would hide a change.
 */
const VOLATILE = ['detail', 'tempo', 'inFlight', 'tokens', 'output', 'children', 'linkScanOffset', 'linkScanPath', 'updatedAt']
const OVER = ['done', 'stopped', 'failed']

/**
 * How old a file's mtime must be for its inode, mtime and size to stand for its text (BTN-1526). Two writes within one
 * tick of the file system's clock (~16 ms on NTFS, 2 s on FAT) share an mtime, and a state change such as `working` to
 * `blocked` keeps the size: a file younger than this is read again on every look, as git treats a "racily clean" entry.
 */
export const FILE_SETTLE_MS = 2_000

interface Listing {
  stamp: string
  at: number
  stdout: Promise<string>
}

interface Job {
  /** Null — written too recently for its stamp to be trusted, and read again next time. */
  file: string | null
  key: string
  over: boolean
}

interface Roster {
  file: string | null
  key: string
  /** Null — the roster cannot be parsed, and every job is looked at. */
  workers: ReadonlySet<string> | null
}

/**
 * `claude agents --json --all` of each account folder, asked again only when what it prints from changes (BTN-1478):
 * each spawn holds the event loop for tens of milliseconds on Windows, and the session monitor lists every folder each
 * few seconds. The stamp is the CLI binary, the live `sessions/<pid>.json` records, `daemon/roster.json` and each job's
 * `state.json` without its `VOLATILE` fields, a file read again only when its inode, mtime or size changes or while it
 * is younger than `FILE_SETTLE_MS`. A job that
 * is over and that the daemon does not hold is not looked at again: only a worker writes its state, and a resume makes
 * it a worker anew, which rewrites the roster. A folder whose jobs cannot be listed is asked every time, and any answer
 * is asked again after `LISTING_MAX_AGE_MS` for what the stamp does not see.
 */
export class FolderListings {
  private readonly listings = new Map<string, Listing>()
  /** By account folder and job id. */
  private readonly jobs = new Map<string, Map<string, Job>>()
  private readonly rosters = new Map<string, Roster>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** `fresh` — the caller waits on a change (a launch, a stop): asked whatever the stamp, and the answer kept. */
  async stdout(dir: string, bin: string, records: SessionRecord[], fresh: boolean, ask: () => Promise<string>): Promise<string> {
    const jobs = await this.jobsStamp(dir)
    const stamp = jobs === null ? null : JSON.stringify([bin, records, jobs])
    const known = this.listings.get(dir)
    if (!fresh && stamp !== null && known?.stamp === stamp && this.now() - known.at < LISTING_MAX_AGE_MS) return known.stdout
    const stdout = ask()
    if (stamp === null) {
      this.listings.delete(dir)
      return stdout
    }
    const listing = { stamp, at: this.now(), stdout }
    this.listings.set(dir, listing)
    stdout.catch(() => this.listings.get(dir) === listing && this.listings.delete(dir))
    return stdout
  }

  /** The roster's stamp, then each job folder's name and key, sorted; null when the jobs or the roster cannot be read. */
  private async jobsStamp(dir: string): Promise<string[] | null> {
    const root = join(dir, 'jobs')
    let names: string[]
    try {
      names = (await readdir(root)).sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
      names = []
    }
    const roster = await this.roster(dir)
    if (roster === null) return null
    const before = this.jobs.get(dir) ?? new Map<string, Job>()
    const after = new Map<string, Job>()
    const keys = await Promise.all(
      names.map((name) => {
        const known = before.get(name)
        const settled = known?.over === true && roster.workers?.has(name) === false
        return settled ? (after.set(name, known), known.key) : jobKey(join(root, name, 'state.json'), known, (job) => after.set(name, job))
      }),
    )
    this.jobs.set(dir, after)
    return keys.includes(null) ? null : [roster.key, ...names.map((name, index) => `${name}|${keys[index]}`)]
  }

  private async roster(dir: string): Promise<Roster | null> {
    const path = join(dir, 'daemon', 'roster.json')
    const info = await stat(path).catch((error: unknown) => ((error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : null))
    if (info === null) return null
    const file = info === undefined ? 'none' : fileStamp(info)
    const known = this.rosters.get(dir)
    if (file !== null && known?.file === file) return known
    const text = info === undefined ? '{"workers":{}}' : await readFile(path, 'utf8').catch(() => null)
    if (text === null) return null
    const roster = { file, key: info === undefined ? 'none' : digest(text), workers: workersOf(text) }
    this.rosters.set(dir, roster)
    return roster
  }
}

/** A file's inode, mtime and size; null while the file is younger than `FILE_SETTLE_MS` or its mtime is ahead. */
function fileStamp(info: Stats): string | null {
  const age = Date.now() - info.mtimeMs
  return age >= FILE_SETTLE_MS ? [info.ino, info.mtimeMs, info.size].join('|') : null
}

/** The steady part of a job's `state.json`, read again only when the file changes; null when it cannot be read now. */
async function jobKey(path: string, known: Job | undefined, keep: (job: Job) => void): Promise<string | null> {
  const info = await stat(path).catch(() => null)
  if (info === null) return 'none'
  const file = fileStamp(info)
  if (file !== null && known?.file === file) {
    keep(known)
    return known.key
  }
  const text = await readFile(path, 'utf8').catch(() => null)
  if (text === null) return null
  const job = { file, ...steadyPart(text) }
  keep(job)
  return job.key
}

function steadyPart(text: string): { key: string; over: boolean } {
  try {
    const state = JSON.parse(text) as unknown
    if (typeof state !== 'object' || state === null || Array.isArray(state)) return { key: digest(text), over: false }
    const key = digest(JSON.stringify(Object.entries(state).filter(([name]) => !VOLATILE.includes(name))))
    return { key, over: OVER.includes((state as { state?: unknown }).state as string) }
  } catch {
    return { key: digest(text), over: false }
  }
}

/** A job's state holds its whole prompt: the stamp of hundreds of jobs keeps only a hash of each. */
const digest = (text: string): string => createHash('sha1').update(text).digest('base64')

function workersOf(text: string): ReadonlySet<string> | null {
  try {
    const { workers } = (JSON.parse(text) ?? {}) as { workers?: unknown }
    return typeof workers === 'object' && workers !== null ? new Set(Object.keys(workers)) : null
  } catch {
    return null
  }
}
