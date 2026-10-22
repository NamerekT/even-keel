import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Checkout } from './model.js'

const git = async (root: string, ...args: string[]): Promise<string> =>
  (await promisify(execFile)('git', args, { cwd: root, windowsHide: true, timeout: 30_000 })).stdout.trim()

/** HEAD of the folder, its branch and tags, and whether tracked files changed; `null` — no git checkout or no git. */
export async function readCheckout(root: string): Promise<Checkout | null> {
  try {
    const commit = await git(root, 'rev-parse', 'HEAD')
    const branch = await git(root, 'symbolic-ref', '--short', '-q', 'HEAD').catch(() => '')
    const tags = (await git(root, 'tag', '--points-at', 'HEAD')).split('\n').filter((tag) => tag !== '')
    const dirty = (await git(root, 'status', '--porcelain', '--untracked-files=no')) !== ''
    return { commit, branch: branch === '' ? null : branch, tags, dirty }
  } catch {
    return null
  }
}
