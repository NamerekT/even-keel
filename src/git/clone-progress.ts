import { notice, type Notice } from '../notice/notice.js'

/** Where a `git clone --progress` is, as its last progress line says. */
export interface CloneProgress {
  /**
   * `receiving` carries the bytes and the speed; `lfs` is the checkout's "Filtering content". Before the first percent
   * (BTN-1099): `connecting` from "Cloning into", `enumerating` while the server lists the objects, with their count.
   */
  stage: 'connecting' | 'enumerating' | 'counting' | 'compressing' | 'receiving' | 'resolving' | 'files' | 'lfs'
  /** Absent in the stages git gives no percent for. */
  percent?: number
  /** The objects the server has listed so far. */
  objects?: number
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
const CLONING = /^Cloning into /
// The server's count without a percent: newer git enumerates, older counts.
const LISTED = /^remote: (?:Enumerating|Counting) objects: (\d+)(?:, done\.)?$/

/** One line of git's progress, as it is split by `\r` or `\n`; `null` — not a progress line. */
export function parseProgress(line: string): CloneProgress | null {
  const text = line.trim()
  if (CLONING.test(text)) return { stage: 'connecting' }
  const listed = LISTED.exec(text)
  if (listed !== null) return { stage: 'enumerating', objects: Number(listed[1]) }
  const found = LINE.exec(text)
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
// The second line is a transfer broken off on its way: curl's 18 (cut short), 28 (too slow) and 56 (receive failure).
const NETWORK = new RegExp(
  [
    /could not resolve host|failed to connect|connection timed out|connection refused|network is unreachable|could not resolve hostname/,
    /operation timed out|connection (?:was )?reset|ssl|unable to look up|rpc failed|curl (?:18|28|56)\b|early eof|unexpected disconnect/,
    /the remote end hung up unexpectedly/,
  ]
    .map((part) => part.source)
    .join('|'),
  'i',
)
const NOT_FOUND = /repository not found|returned error: 404|does not appear to be a git repository|not found|does not exist/i
// A private repository over HTTP answers a git that is not signed in as if it were not there.
const HTTP_HIDDEN = /repository not found|returned error: 404/i
const HTTP_REMOTE = /^https?:\/\//i
const HOST_KEY = /host key verification failed/i
const SSH_KEY = /permission denied \(publickey/i

/**
 * Why git could not reach a remote, by what it printed (BTN-1091): an SSH host key never accepted on this machine, with
 * the command that accepts it; no SSH key the server takes; no rights over HTTP, a private repository's "not found"
 * included; no such repository; the network; or anything else, with git's words in the detail.
 */
export function remoteFailure(out: string, remote: string): Notice {
  const probe = HOST_KEY.test(out) ? sshProbe(remote) : null
  if (probe !== null) return notice('git.remoteHostKey', { remote, ...probe }, { detail: out })
  const code = SSH_KEY.test(out)
    ? 'git.remoteSshKey'
    : DENIED.test(out) || (HTTP_REMOTE.test(remote.trim()) && HTTP_HIDDEN.test(out))
      ? 'git.remoteDenied'
      : NETWORK.test(out)
        ? 'git.remoteNetwork'
        : NOT_FOUND.test(out)
          ? 'git.remoteNotFound'
          : 'git.remoteFailed'
  return notice(code, { remote }, { detail: out })
}

/** How far a clone got before it failed: the server's answer, and the percent of the objects received. */
export interface CloneReach {
  /** The server listed or sent anything: past "Cloning into", which git prints before it connects. */
  answered: boolean
  percent?: number
}

/**
 * Why a clone failed (BTN-1100): the network breaking off after the server answered is a clone broken halfway, with the
 * percent received — not an address to check; a checkout failed after the clone came is not the remote's either: an LFS
 * file as `lfsFailure` reads it, anything else files not written out; the rest as `remoteFailure` reads it.
 */
export function cloneFailure(out: string, remote: string, reach: CloneReach): Notice {
  const lfs = lfsFailure(out, remote)
  if (lfs !== null) return lfs
  if (CHECKOUT_FAILED.test(out)) return notice('git.checkoutFailed', {}, { detail: out })
  const failure = remoteFailure(out, remote)
  if (failure.code !== 'git.remoteNetwork' || !reach.answered) return failure
  return notice('git.cloneBroken', reach.percent === undefined ? {} : { percent: reach.percent }, { detail: out })
}

const CHECKOUT_FAILED = /clone succeeded, but checkout failed/i
const LFS_SMUDGE = /^fatal: (.+): smudge filter lfs failed\s*$/m
// A server over HTTP answers 404; a local or SSH remote's own transfer says it has no such object.
const LFS_MISSING = /\[404\]|remote missing object|object does not exist on the server/i

/**
 * A file of Git LFS the checkout could not download (BTN-1106), by git's last words on it: missing on the server — never
 * uploaded, with the push that uploads it from a clone that has it — or not downloaded for another reason. `null` —
 * not an LFS failure.
 */
export function lfsFailure(out: string, remote: string): Notice | null {
  const smudge = LFS_SMUDGE.exec(out)
  if (smudge === null) return null
  const path = smudge[1]!.trim()
  return LFS_MISSING.test(out)
    ? notice('git.lfsMissing', { path, remote, command: `git lfs push --all ${remote}` }, { detail: out })
    : notice('git.lfsFailed', { path }, { detail: out })
}

/**
 * The server of an SSH remote as `known_hosts` names it — `host`, or `[host]:port` off port 22 (BTN-1105) — and
 * `ssh -T [-p <port>] [user@]host`: run once in a terminal, it asks to accept the host's key.
 */
export function sshProbe(remote: string): { host: string; command: string } | null {
  const text = remote.trim()
  const url = /^(?:git\+)?ssh:\/\/(?:([^@/]+)@)?([^/:]+)(?::(\d+))?\//i.exec(text)
  const scp = url === null && !text.includes('://') ? /^(?:([^\s@/:]+)@)?([^\s@/:]{2,}):/.exec(text) : null
  const found = url ?? scp
  if (found === null) return null
  const name = found[2]!
  const port = url?.[3]
  const user = found[1] === undefined ? '' : `${found[1]}@`
  return {
    host: port === undefined || port === '22' ? name : `[${name}]:${port}`,
    command: `ssh -T ${port === undefined ? '' : `-p ${port} `}${user}${name}`,
  }
}

const URL_FORM = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i
// `[user@]host:path`; a one-letter host is a Windows drive.
const SCP_FORM = /^(?:[^\s@/:]+@)?[^\s@/:]{2,}:[^\s]+$/
const LOCAL_FORM = /^(?:\/|[a-z]:[\\/]|\\\\)/i

/**
 * A text git could take for a remote (BTN-1087): a URL, `[user@]host:path` or a full local path — spaces only in the
 * last. Anything else is refused without asking git, which would answer a pasted paragraph with a page of errors.
 */
export function remoteShaped(remote: string): boolean {
  const text = remote.trim()
  return URL_FORM.test(text) || SCP_FORM.test(text) || LOCAL_FORM.test(text)
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
