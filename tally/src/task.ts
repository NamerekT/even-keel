const TASK_BRANCH = /^([a-z][a-z0-9]*)-(\d+)\//i
const WORKTREE = /[\\/]\.claude[\\/]worktrees[\\/]([a-z][a-z0-9]*)-(\d+)(?:[\\/]|$)/i
const WORKTREE_TAIL = /[\\/]\.claude[\\/]worktrees(?:[\\/].*)?$/i

export interface TaskHints {
  launch?: string | null
  branch?: string | null
  cwd?: string | null
}

export function taskOf({ launch, branch, cwd }: TaskHints): string | null {
  if (launch) return launch
  const named = (branch ? TASK_BRANCH.exec(branch) : null) ?? (cwd ? WORKTREE.exec(cwd) : null)
  return named === null ? null : `${named[1]!.toUpperCase()}-${named[2]}`
}

export interface Place {
  project: string | null
  dir: string | null
}

export function placeOf(cwd: string | null | undefined): Place {
  if (!cwd) return { project: null, dir: null }
  const dir = cwd.replace(WORKTREE_TAIL, '').replace(/[\\/]+$/, '')
  const project = dir.split(/[\\/]/).pop() ?? ''
  return project === '' ? { project: null, dir: null } : { project, dir }
}
