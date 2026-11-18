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
  /** The commit and tree main went out at, read on the machine that pushed it (BTN-995); absent — not pushed or unknown. */
  main?: { commit: string; tree: string }
  /** What the cleanup of a slot's temporary files freed (BTN-1315); absent — nothing deleted or no slot. */
  freed?: { slot: string; bytes: number; files: number }
  /** The machine the cleanup ran on, which holds main's commits if its sync failed; set by the machine pool. */
  machine?: string
}

/** What a task's folder holds beyond the main branch: the commits of its branch, and the files left out of a commit. */
export interface Changes {
  ahead: number
  files: number
}
