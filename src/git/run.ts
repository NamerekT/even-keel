import { execFile } from 'node:child_process'
import type { Git, GitResult } from './types.js'

const LOCAL_TIMEOUT_MS = 60_000
const NETWORK_TIMEOUT_MS = 5 * 60_000
const NETWORK = new Set(['sync', 'push', 'fetch', 'ls-remote'])

/**
 * Git for Windows ignores the system's long path support without its own `core.longpaths` (BTN-559). The service reads
 * task worktrees while their sessions work in them: without `--no-optional-locks` a `status` takes `index.lock` to
 * refresh the index, and the session's own `git add` meanwhile fails on it (BTN-697).
 */
export function gitArgs(cwd: string, args: string[], platform: NodeJS.Platform = process.platform): string[] {
  return ['--no-optional-locks', ...(platform === 'win32' ? ['-c', 'core.longpaths=true'] : []), '-C', cwd, ...args]
}

/** A missing binary, or macOS's git stub without Command Line Tools; license failures remain git errors. */
export function gitMissing(errorCode: string | number | null | undefined, out: string, platform: NodeJS.Platform = process.platform): boolean {
  return errorCode === 'ENOENT' || (platform === 'darwin' && typeof errorCode === 'number' && errorCode !== 0 && out.includes('xcrun: error: invalid active developer path'))
}

export const runGit: Git = (cwd, args) =>
  new Promise<GitResult>((resolve) => {
    const timeout = NETWORK.has(args[0]!) ? NETWORK_TIMEOUT_MS : LOCAL_TIMEOUT_MS
    execFile(
      'git',
      gitArgs(cwd, args),
      { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout, stderr) => {
        const out = [stdout, stderr].map((text) => text.trim()).filter(Boolean).join('\n')
        if (error === null) resolve({ code: 0, out: stdout.trim() })
        // No `cwd` is passed, so ENOENT is the git binary itself.
        else if (gitMissing(error.code, out)) resolve({ code: -1, out: out || error.message, missing: true })
        else resolve({ code: typeof error.code === 'number' ? error.code : -1, out: out || error.message })
      },
    )
  })
