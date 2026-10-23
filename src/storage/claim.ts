import { randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'

// A PGlite folder has one session in one process: the process that opened it owns it, serves it to pg clients on a
// loopback port and names itself and the port in owner.json (BTN-198). The file is claimed before PGlite opens the
// folder, with no port yet: two processes starting together cannot both see "no owner" and open it (BTN-301). The
// state database and Tally's local one are claimed the same way (BTN-320).

const CONNECT_TIMEOUT_MS = 1_000
// A claim without a port whose pid still runs is an open in progress, unless it is this old: then its process died
// mid-open and the pid went to another one.
const OPENING_LIMIT_MS = 10 * 60_000
const CLAIM_ATTEMPTS = 5

export interface Owner {
  pid: number
  port: number
}

/** What owner.json holds: the claimant, and its port once it serves the database. */
export interface Claim {
  pid: number
  since: number
  port?: number
}

const ownerFile = (dir: string) => join(dir, 'owner.json')

export async function readOwner(dir: string): Promise<Owner | null> {
  const { claim } = await readClaim(dir)
  return claim?.port === undefined ? null : { pid: claim.pid, port: claim.port }
}

export function writeOwner(dir: string, owner: Owner): void {
  // A rename replaces the file whole: a reader never sees it half written.
  const draft = draftOf(dir)
  writeFileSync(draft, JSON.stringify({ ...owner, since: Date.now() }))
  renameSync(draft, ownerFile(dir))
}

export function removeOwner(dir: string): void {
  rmSync(ownerFile(dir), { force: true })
}

/** Removes a claim of this process: one left by a thread of it that was terminated and can own nothing any more. */
export function releaseOwn(dir: string): void {
  let raw: string
  try {
    raw = readFileSync(ownerFile(dir), 'utf8')
  } catch {
    return
  }
  let pid: unknown
  try {
    pid = (JSON.parse(raw) as Partial<Claim> | null)?.pid
  } catch {
    return
  }
  if (pid === process.pid) removeUnchanged(dir, raw)
}

const draftOf = (dir: string) => join(dir, `owner.${randomUUID()}.tmp`)

/**
 * Claims the folder for this process, or names the live claimant that holds it: `null` — claimed here. The claim is a
 * hard link put in place, which fails while one is there, so of two processes only one gets it; one left by a process
 * that is gone is removed and claimed again.
 */
export async function claim(dir: string): Promise<Claim | null> {
  mkdirSync(dir, { recursive: true })
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    if (placed(dir)) return null
    const found = await readClaim(dir)
    if (found.claim !== null) return found.claim
    if (found.raw !== undefined) removeUnchanged(dir, found.raw)
  }
  throw new Error(`could not claim the database in ${dir}: its owner.json keeps changing`)
}

function placed(dir: string): boolean {
  const draft = draftOf(dir)
  writeFileSync(draft, JSON.stringify({ pid: process.pid, since: Date.now() } satisfies Claim))
  try {
    linkSync(draft, ownerFile(dir))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  } finally {
    rmSync(draft, { force: true })
  }
}

// Another process may have taken a stale claim's place since it was read: only the same text is removed.
function removeUnchanged(dir: string, raw: string): void {
  try {
    if (readFileSync(ownerFile(dir), 'utf8') === raw) removeOwner(dir)
  } catch {
    // Gone already.
  }
}

/** The live claim of the folder, if any, and the text of owner.json as read: `undefined` — there is none. */
async function readClaim(dir: string): Promise<{ claim: Claim | null; raw?: string }> {
  let raw: string
  try {
    raw = readFileSync(ownerFile(dir), 'utf8')
  } catch {
    return { claim: null }
  }
  return { claim: await liveClaim(raw), raw }
}

// A live owner both runs and listens: after a crash its pid may belong to another process by now.
async function liveClaim(raw: string): Promise<Claim | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const { pid, port, since } = (parsed ?? {}) as Partial<Claim>
  if (!Number.isInteger(pid) || !alive(pid!)) return null
  if (port === undefined) return Number.isFinite(since) && Date.now() - since! < OPENING_LIMIT_MS ? { pid: pid!, since: since! } : null
  return Number.isInteger(port) && (await listening(port)) ? { pid: pid!, since: since ?? 0, port } : null
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function listening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port, timeout: CONNECT_TIMEOUT_MS })
    const finish = (open: boolean) => {
      socket.destroy()
      done(open)
    }
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}
