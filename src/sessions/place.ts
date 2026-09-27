import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { HandoffSession } from '../chain/relay.js'

const run = promisify(execFile)
const GIT_TIMEOUT_MS = 10_000

export async function locateWorktree(session: HandoffSession): Promise<HandoffSession> {
  const root = await git(session.workdir, 'rev-parse', '--show-toplevel')
  if (root === null) return session
  const branch = await git(root, 'branch', '--show-current')
  return { ...session, workdir: resolve(root), branch: branch === '' ? null : branch }
}

async function git(cwd: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT_MS, windowsHide: true })
    return stdout.trim()
  } catch {
    return null
  }
}
