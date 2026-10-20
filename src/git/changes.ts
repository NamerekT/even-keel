import type { Changes, Git } from './types.js'
import { must } from './worktree.js'

/**
 * Whether a task whose session marked it `NO CHANGES:` really changed nothing (EKR-10). Out of PR mode the local main
 * is the one sessions merge into, so it is counted against without a fetch. Files git ignores (`.temp/`) are not work.
 */
export async function changesOf(git: Git, workdir: string, main: string): Promise<Changes> {
  const counted = await must(git, workdir, ['rev-list', '--count', `${main}..HEAD`], 'countCommits', main)
  const status = await must(git, workdir, ['status', '--porcelain', '--untracked-files=all'], 'readStatus')
  return { ahead: Number(counted.out), dirty: status.out !== '' }
}
