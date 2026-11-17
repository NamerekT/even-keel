// What `even-keel install` checks and says around the install of a hub or a machine (BTN-1243).
import type { LinkFile } from './machine/join.js'

const NODE_MAJOR = 24

export interface Prerequisites {
  /** `process.versions.node`. */
  node: string
  /** The output of `git --version`; `null` — no git on `PATH`. */
  git: string | null
  machine: boolean
}

/** Why this install cannot go on; `null` — it can. A hub may run projects without git, a machine never does. */
export function prerequisiteRefusal({ node, git, machine }: Prerequisites): string | null {
  const major = Number(node.split('.')[0])
  if (!(major >= NODE_MAJOR)) return `Even Keel needs Node.js ${NODE_MAJOR} or newer; this is ${node}. Install it from nodejs.org and run this again`
  if (machine && git === null) {
    return 'a machine needs git: it runs the tasks in worktrees of their repositories. Install it from git-scm.com, set git config --global user.name and user.email, and run this again'
  }
  return null
}

/** The one command that makes a computer a machine of a hub: the same version as the hub's, on any OS. */
export function installCommandOf(version: string, line: string): string {
  return `npx even-keel@${version} install --machine ${line}`
}

export interface ContactWait {
  now(): number
  sleep(ms: number): Promise<void>
  timeoutMs?: number
}

/** Waits until the machine's process has written a contact with the hub later than `since`. Whether it did in time. */
export async function waitForContact(read: () => LinkFile | undefined, since: number, wait: ContactWait): Promise<boolean> {
  const deadline = wait.now() + (wait.timeoutMs ?? 30_000)
  for (;;) {
    const contactAt = read()?.contactAt
    if (contactAt !== undefined && contactAt >= since) return true
    if (wait.now() >= deadline) return false
    await wait.sleep(1_000)
  }
}

export function contactMessageOf(reached: boolean, hub: string, log: string): string {
  if (reached) return `even-keel: the machine is connected to the hub ${hub}; give it projects on the hub page`
  return `even-keel: the machine has not reached the hub ${hub} in 30 s; it keeps trying. Look at ${log}, and at even-keel status for the last contact`
}
