import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { HandoffSession } from '../chain/relay.js'
import { isInside, samePath } from '../paths.js'

const run = promisify(execFile)
const GIT_TIMEOUT_MS = 10_000

type Git = (cwd: string, ...args: string[]) => Promise<string | null>

/**
 * The worktree of the folder the session last worked in. A repository nested in the launch folder that is not
 * a worktree of the same repository (a clone the session made under `.temp/`) is skipped for the one around it.
 */
export async function locateWorktree(session: HandoffSession, git: Git = runGit): Promise<HandoffSession> {
  const launched = await git(session.cwd, 'rev-parse', '--show-toplevel')
  const family = launched === null ? null : await commonDir(git, launched)
  let root = await git(session.workdir, 'rev-parse', '--show-toplevel')
  while (root !== null && launched !== null && family !== null && isInside(root, launched) && !samePath(root, launched)) {
    const own = await commonDir(git, root)
    if (own !== null && samePath(own, family)) break
    root = await git(dirname(root), 'rev-parse', '--show-toplevel')
  }
  if (root === null) return session
  const branch = await git(root, 'branch', '--show-current')
  return { ...session, workdir: resolve(root), branch: branch === '' ? null : branch }
}

function commonDir(git: Git, cwd: string): Promise<string | null> {
  return git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')
}

async function runGit(cwd: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT_MS, windowsHide: true })
    return stdout.trim()
  } catch {
    return null
  }
}
