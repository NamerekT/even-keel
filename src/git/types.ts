import type { Notice } from '../notice/notice.js'

export interface GitResult {
  code: number
  out: string
  /** Git is not on the service's PATH, or is macOS's stub without Command Line Tools. */
  missing?: true
}

export type Git = (cwd: string, args: string[]) => Promise<GitResult>

export interface TaskPlace {
  path: string
  branch: string | null
}

export interface FinishOutcome {
  warnings: Notice[]
  syncError: Notice | null
}

/** What a task's folder holds beyond the main branch: the commits of its branch, and the files left out of a commit. */
export interface Changes {
  ahead: number
  files: number
}
