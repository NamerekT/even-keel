import { execFile } from 'node:child_process'
import type { Git, GitResult } from './types.js'

const LOCAL_TIMEOUT_MS = 60_000
const NETWORK_TIMEOUT_MS = 5 * 60_000
const NETWORK = new Set(['sync', 'push', 'fetch', 'ls-remote'])

/** Git for Windows ignores the system's long path support without its own `core.longpaths` (BTN-559). */
export function gitArgs(cwd: string, args: string[], platform: NodeJS.Platform = process.platform): string[] {
  return [...(platform === 'win32' ? ['-c', 'core.longpaths=true'] : []), '-C', cwd, ...args]
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
        else resolve({ code: typeof error.code === 'number' ? error.code : -1, out: out || error.message })
      },
    )
  })
