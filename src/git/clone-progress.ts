import { notice, type Notice } from '../notice/notice.js'

/** Where a `git clone --progress` is, as its last progress line says. */
export interface CloneProgress {
  /** `receiving` carries the bytes and the speed; `lfs` is the checkout's "Filtering content". */
  stage: 'counting' | 'compressing' | 'receiving' | 'resolving' | 'files' | 'lfs'
  percent: number
  /** Bytes received so far and per second, where git says them. */
  bytes?: number
  speed?: number
}

const STAGES: Readonly<Record<string, CloneProgress['stage']>> = {
  'Counting objects': 'counting',
  'Enumerating objects': 'counting',
  'Compressing objects': 'compressing',
  'Receiving objects': 'receiving',
  'Resolving deltas': 'resolving',
  'Updating files': 'files',
  'Checking out files': 'files',
  'Filtering content': 'lfs',
}

const UNITS: Readonly<Record<string, number>> = { bytes: 1, B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }
const LINE = /^(?:remote: )?([A-Z][a-z]+ [a-z]+(?: [a-z]+)?):\s+(\d+)%/
const SIZE = /, ([\d.]+) (bytes|B|KiB|MiB|GiB)(?: \| ([\d.]+) (bytes|B|KiB|MiB|GiB)\/s)?/

/** One line of git's progress, as it is split by `\r` or `\n`; `null` — not a progress line. */
export function parseProgress(line: string): CloneProgress | null {
  const found = LINE.exec(line.trim())
  const stage = found === null ? undefined : STAGES[found[1]!]
  if (found === null || stage === undefined) return null
  const size = SIZE.exec(line)
  return {
    stage,
    percent: Number(found[2]),
    ...(size === null ? {} : { bytes: Math.round(Number(size[1]) * UNITS[size[2]!]!) }),
    ...(size?.[3] === undefined ? {} : { speed: Math.round(Number(size[3]) * UNITS[size[4]!]!) }),
  }
}

const DENIED = /authentication failed|permission denied|could not read (?:username|password)|terminal prompts disabled|returned error: 40[13]|access denied|invalid credentials|logon failed/i
const NETWORK = /could not resolve host|failed to connect|connection timed out|connection refused|network is unreachable|could not resolve hostname|operation timed out|connection reset|ssl|unable to look up/i
const NOT_FOUND = /repository not found|returned error: 404|does not appear to be a git repository|not found|does not exist/i

/**
 * Why git could not reach a remote, by what it printed: no rights (the machine's git credentials), no such repository,
 * the network, or anything else with git's words in the detail. A private repository answers "not found" to a reader
 * without rights, so that notice names both.
 */
export function remoteFailure(out: string, remote: string): Notice {
  const code = DENIED.test(out) ? 'git.remoteDenied' : NETWORK.test(out) ? 'git.remoteNetwork' : NOT_FOUND.test(out) ? 'git.remoteNotFound' : 'git.remoteFailed'
  return notice(code, { remote }, { detail: out })
}

/** What `git ls-remote --symref <url> HEAD refs/heads/*` printed: the default branch and every branch. */
export function parseHeads(out: string): { head: string | null; branches: string[] } {
  let head: string | null = null
  const branches: string[] = []
  for (const line of out.split(/\r?\n/)) {
    const symref = /^ref: refs\/heads\/(\S+)\s+HEAD$/.exec(line)
    if (symref !== null) head = symref[1]!
    const branch = /^[0-9a-f]+\s+refs\/heads\/(\S+)$/.exec(line)
    if (branch !== null) branches.push(branch[1]!)
  }
  return { head, branches }
}

/** The repository's name an address ends with, the folder `git clone` would make: `storefront` of `…/storefront.git`. */
export function remoteName(remote: string): string {
  const parts = remote.trim().replace(/[\\/]+$/, '').split(/[\\/:]/)
  return (parts.pop() ?? '').replace(/\.git$/i, '')
}

/** Two addresses of one repository: the scheme, the user, a trailing slash, `.git` and the host's case apart. */
export function sameRemote(a: string, b: string): boolean {
  return remoteKey(a) === remoteKey(b)
}

function remoteKey(remote: string): string {
  const text = remote.trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '')
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(text)
  if (scp !== null && !text.includes('://')) return `${scp[1]!.toLowerCase()}/${scp[2]!.replace(/^\/+/, '')}`
  const url = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(text)
  return url === null ? text.replaceAll('\\', '/') : `${url[1]!.toLowerCase()}/${url[2]!}`
}
