import type { Notice } from '../notice/notice.js'

// The settings of the automatic backup (BTN-1083), without `node:*`: the registry and the page read them.

/** What the page shows of the backup. */
export interface BackupView {
  /** The copies' folder, resolved: the setting or its default. */
  dir: string
  /** When the newest checked copy was checked; `null` — there is none in `dir`. */
  at: string | null
  running: boolean
  failure: Notice | null
}

export const DEFAULT_BACKUP_KEEP = 14
export const MAX_BACKUP_KEEP = 365

/** `backup.dir` — an absolute folder, `null` for `backups/` in the state folder; `backup.keep` — the checked copies kept. */
export interface BackupConfig {
  dir: string | null
  keep: number
}

export const DEFAULT_BACKUP: BackupConfig = { dir: null, keep: DEFAULT_BACKUP_KEEP }
