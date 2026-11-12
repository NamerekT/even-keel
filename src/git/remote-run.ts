import { execFile, spawn } from 'node:child_process'
import { fail, NoticeError, type Notice } from '../notice/notice.js'
import { parseHeads, parseProgress, remoteFailure, type CloneProgress } from './clone-progress.js'
import { gitMissing } from './run.js'

const READ_TIMEOUT_MS = 30_000
const READ_CACHE_MS = 60_000
/** What is kept of git's words for a failure's detail. */
const KEPT_CHARS = 4000

export interface RemoteRun {
  code: number
  out: string
  missing?: true
  /** Ended by its signal or its timeout. */
  stopped?: true
}

interface RunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  /** Each line of stderr, where git writes its progress with `\r` between the lines. */
  onLine?: (line: string) => void
}

export type RemoteGit = (args: string[], options?: RunOptions) => Promise<RemoteRun>

/**
 * A service has nobody to ask: no terminal prompt and no window of Git Credential Manager, which a Windows service
 * would wait on unseen. Git then fails with what the machine's saved credentials give.
 */
export function remoteEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
}

/** Git on a remote, with no working folder: `ls-remote`, `clone`. Its output is kept from both streams, cut to its end. */
export const runRemoteGit: RemoteGit = (args, { signal, timeoutMs, onLine } = {}) =>
  new Promise<RemoteRun>((resolve) => {
    const child = spawn('git', [...(process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : []), ...args], {
      env: remoteEnv(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let rest = ''
    let stopped = false
    const keep = (text: string) => {
      out = (out + text).slice(-KEPT_CHARS)
    }
    const stop = () => {
      stopped = true
      killTree(child.pid)
    }
    const timer = timeoutMs === undefined ? undefined : setTimeout(stop, timeoutMs)
    if (signal?.aborted === true) stop()
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', (chunk: Buffer) => keep(chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => {
      const lines = (rest + chunk.toString()).split(/[\r\n]/)
      rest = lines.pop() ?? ''
      for (const line of lines) {
        onLine?.(line)
        // The progress lines would push git's reason out of what is kept.
        if (line.trim() !== '' && parseProgress(line) === null) keep(`${line}\n`)
      }
    })
    const done = (code: number, errorCode?: string) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      keep(rest)
      const text = out.trim()
      if (gitMissing(errorCode ?? code, text)) resolve({ code: -1, out: text, missing: true })
      else resolve({ code, out: text, ...(stopped ? { stopped: true as const } : {}) })
    }
    child.on('error', (error: NodeJS.ErrnoException) => done(-1, error.code))
    child.on('close', (code) => done(code ?? -1))
  })

/** Git starts helpers of its own (`git-remote-https`, `ssh`): on Windows a kill of git alone leaves them holding the folder. */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Gone already.
    }
  }
}

export interface RemoteHeads {
  /** The default branch; `null` — an empty repository. */
  head: string | null
  branches: string[]
}

/** The branches of a remote, or why git could not read it. */
export type ReadRemote = (remote: string) => Promise<RemoteHeads | Notice>

export const isHeads = (read: RemoteHeads | Notice): read is RemoteHeads => 'branches' in read

/** Asks the remote once a minute at most: the wizard checks its draft on every field typed. A failure is asked again. */
export function remoteReader(git: RemoteGit = runRemoteGit, now: () => number = Date.now): ReadRemote {
  const known = new Map<string, { at: number; heads: RemoteHeads }>()
  return async (remote) => {
    const held = known.get(remote)
    if (held !== undefined && now() - held.at < READ_CACHE_MS) return held.heads
    const read = await git(['ls-remote', '--symref', '--', remote, 'HEAD', 'refs/heads/*'], { timeoutMs: READ_TIMEOUT_MS })
    if (read.missing === true) return fail('git.missing', {}).notice
    if (read.stopped === true) return remoteFailure('connection timed out', remote)
    if (read.code !== 0) return remoteFailure(read.out, remote)
    const heads = parseHeads(read.out)
    known.set(remote, { at: now(), heads })
    return heads
  }
}

/** The reader the wizard's checks and the creation of a project share: a remote checked is not asked again on "Create". */
export const sharedRemoteReader = remoteReader()

export interface CloneRequest {
  remote: string
  path: string
  /** `null` — the remote's default branch. */
  branch: string | null
  signal: AbortSignal
  onProgress: (progress: CloneProgress) => void
}

export type Clone = (request: CloneRequest) => Promise<void>

/** `git clone --progress` into the folder; no timeout — a large repository takes as long as it takes, its window has Cancel. */
export function cloner(git: RemoteGit = runRemoteGit): Clone {
  return async ({ remote, path, branch, signal, onProgress }) => {
    const args = ['clone', '--progress', ...(branch === null ? [] : ['--branch', branch]), '--', remote, path]
    const run = await git(args, {
      signal,
      onLine: (line) => {
        const progress = parseProgress(line)
        if (progress !== null) onProgress(progress)
      },
    })
    if (run.missing === true) throw fail('git.missing', {})
    if (run.stopped === true) throw fail('git.cloneStopped', {})
    if (run.code !== 0) throw new NoticeError(remoteFailure(run.out, remote))
  }
}
