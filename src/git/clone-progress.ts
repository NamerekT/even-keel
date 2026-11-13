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
  if (probe !== null) return notice('git.remoteHostKey', { remote, command: probe }, { detail: out })
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

/** `ssh -T [-p <port>] [user@]host` of an SSH remote: run once in a terminal, it asks to accept the host's key. */
export function sshProbe(remote: string): string | null {
  const text = remote.trim()
  const url = /^(?:git\+)?ssh:\/\/(?:([^@/]+)@)?([^/:]+)(?::(\d+))?\//i.exec(text)
  const scp = url === null && !text.includes('://') ? /^(?:([^\s@/:]+)@)?([^\s@/:]{2,}):/.exec(text) : null
  const found = url ?? scp
  if (found === null) return null
  const port = url?.[3]
  const user = found[1] === undefined ? '' : `${found[1]}@`
  return `ssh -T ${port === undefined ? '' : `-p ${port} `}${user}${found[2]!}`
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
