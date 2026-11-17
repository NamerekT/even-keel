import { createServer, type AddressInfo } from 'node:net'
import { readLinkFile, writeLinkFile } from '../machine/join.js'
import { claim, removeOwner, writeOwner, type Claim } from '../storage/claim.js'
import { databaseDirOf } from '../storage/owner.js'

/** How often the time of the last contact with the hub is written while the link holds. */
export const CONTACT_EVERY_MS = 60_000

/** Whether this installation runs as a machine of a hub elsewhere: `join` wrote its link file (BTN-1242). */
export function joinedHub(stateDir: string): boolean {
  return readLinkFile(stateDir) !== undefined
}

/** The installation held by this process; `release` lets it go. */
export interface Held {
  release(): Promise<void>
}

/**
 * Holds the installation's state folder the way the hub's process does (`src/storage/claim.ts`), with no state database
 * in it: one service per installation, and `join` sees that it runs. The claim names a loopback port that only proves
 * the process lives. `Claim` — the live process that holds it already.
 */
export async function holdInstallation(stateDir: string): Promise<Held | Claim> {
  const dir = databaseDirOf(stateDir)
  const claimant = await claim(dir)
  if (claimant !== null) return claimant
  const server = createServer((socket) => socket.end())
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    server.unref()
    writeOwner(dir, { pid: process.pid, port: (server.address() as AddressInfo).port })
  } catch (error) {
    removeOwner(dir)
    server.close()
    throw error
  }
  return {
    release: async () => {
      removeOwner(dir)
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

/**
 * Writes when the hub was last heard into the link file `even-keel status` reads: at once when the link comes up, then
 * at most every `CONTACT_EVERY_MS` while it holds.
 */
export function contactKeeper(stateDir: string, log: (line: string) => void, now: () => number = Date.now): (online: boolean, contactAt: number | undefined) => void {
  let written: number | undefined
  let wasOnline = false
  return (online, contactAt) => {
    const cameUp = online && !wasOnline
    wasOnline = online
    if (contactAt === undefined || contactAt === written) return
    if (!cameUp && written !== undefined && now() - written < CONTACT_EVERY_MS) return
    const file = readLinkFile(stateDir)
    if (file === undefined) return
    try {
      writeLinkFile(stateDir, { ...file, contactAt })
      written = contactAt
    } catch (error) {
      log(`machine: the last contact with the hub was not written: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
