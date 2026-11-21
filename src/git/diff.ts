import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { BranchDiff } from '../state.js'
import type { Git } from './types.js'
import { must } from './worktree.js'

/** An untracked file larger than this is not counted: a dump or a build left out of `.gitignore`, not written lines. */
const UNTRACKED_MAX_BYTES = 4 * 1024 * 1024
/** Git takes a file with a NUL byte in its first 8000 for binary, and `--numstat` counts no lines of it. */
const BINARY_PROBE_BYTES = 8000

/**
 * The lines a task's branch changed against the project's main branch (BTN-1424): from the commit where the branch left
 * `main` to the working tree, so what is not committed yet counts too, untracked files with it. Binary files count no
 * lines, as in `git diff --numstat`; files git ignores (`.temp/`) are not counted.
 */
export async function branchDiffOf(git: Git, workdir: string, main: string): Promise<BranchDiff> {
  const base = (await must(git, workdir, ['merge-base', main, 'HEAD'], 'countCommits', main)).out
  const tracked = await must(git, workdir, ['diff', '--numstat', base], 'readStatus')
  const diff: BranchDiff = { added: 0, removed: 0 }
  for (const line of tracked.out.split('\n')) {
    const [added, removed] = line.split('\t')
    if (added === undefined || removed === undefined || added === '-') continue
    diff.added += Number(added) || 0
    diff.removed += Number(removed) || 0
  }
  const untracked = await must(git, workdir, ['ls-files', '--others', '--exclude-standard', '-z'], 'readStatus')
  for (const name of untracked.out.split('\0')) {
    if (name !== '') diff.added += await linesOf(join(workdir, name))
  }
  return diff
}

/** The lines of a text file as `--numstat` counts them; a binary, too large or unreadable file has none. */
async function linesOf(path: string): Promise<number> {
  const file = await open(path, 'r').catch(() => null)
  if (file === null) return 0
  try {
    const { size } = await file.stat()
    if (size === 0 || size > UNTRACKED_MAX_BYTES) return 0
    const { buffer } = await file.read({ buffer: Buffer.alloc(size), position: 0 })
    if (buffer.subarray(0, BINARY_PROBE_BYTES).includes(0)) return 0
    let lines = 0
    for (const byte of buffer) if (byte === 0x0a) lines++
    return buffer[size - 1] === 0x0a ? lines : lines + 1
  } finally {
    await file.close()
  }
}
