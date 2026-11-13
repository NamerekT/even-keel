import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Git } from '../git/types.js'
import type { FoundRepository } from '../state.js'
import { ownRepository } from './git-mode.js'

/**
 * Whether the folder of a project without git has become a repository of its own (BTN-1025), each step only once the
 * one before holds: git starts on the machine (`gitStarts`, the setup's own read), the folder has a `.git` (no git
 * call), and `git rev-parse --show-toplevel` names the folder itself — the one git call, read-only, which turns down an
 * empty or broken `.git` and a folder inside another repository. `null` — not one.
 */
export async function foundRepository(git: Git, folder: string, gitStarts: boolean): Promise<FoundRepository | null> {
  if (!gitStarts) return null
  const dotGit = join(folder, '.git')
  const entry = await stat(dotGit).catch(() => null)
  if (entry === null || !(await ownRepository(git, folder))) return null
  // A file system without a birth time gives 0: the change time stands in, steady while git is off in the folder.
  return { branch: entry.isDirectory() ? await headBranch(dotGit) : null, since: Math.round(entry.birthtimeMs || entry.ctimeMs) }
}

/** The branch `HEAD` points at, read from the file; `null` — detached or unreadable. */
async function headBranch(dotGit: string): Promise<string | null> {
  const head = await readFile(join(dotGit, 'HEAD'), 'utf8').catch(() => '')
  return /^ref: refs\/heads\/(.+)$/m.exec(head)?.[1]?.trim() ?? null
}

/**
 * The projects without git whose folder was a repository at the last check (BTN-1025). Checked at the start and after
 * a Done of such a project's task, when its agent may have made one; never on a timer.
 */
export class GitFound {
  private readonly found = new Map<string, FoundRepository>()
  /** What the page shows changed. */
  changed: (() => void) | undefined

  constructor(
    private readonly deps: {
      git: Git
      gitStarts: () => boolean
      /** The folders of the projects without git, by id. */
      folders: () => Record<string, string>
      /** What the log names a project by. */
      label?: (project: string) => string
    },
  ) {}

  /** By project id, only the projects still without git. */
  view(): Record<string, FoundRepository> {
    const folders = this.deps.folders()
    return Object.fromEntries([...this.found].filter(([project]) => folders[project] !== undefined))
  }

  async check(project: string): Promise<void> {
    const folder = this.deps.folders()[project]
    const read = folder === undefined ? null : await foundRepository(this.deps.git, folder, this.deps.gitStarts()).catch(() => null)
    const before = this.found.get(project)
    if (read === null) {
      if (before === undefined) return
      this.found.delete(project)
    } else {
      if (before !== undefined && before.branch === read.branch && before.since === read.since) return
      this.found.set(project, read)
      console.log(`git: the folder of ${this.deps.label?.(project) ?? project}, a project without git, is a repository now; the page offers to turn git on`)
    }
    this.changed?.()
  }

  async checkAll(): Promise<void> {
    await Promise.all(Object.keys(this.deps.folders()).map((project) => this.check(project)))
  }
}
