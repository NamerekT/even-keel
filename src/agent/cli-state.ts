/** Ephemeral copy state shared with the page; no download is started by reading it. */
export interface CliCopyView {
  version: string
  source: 'checked' | 'system'
  status: 'missing' | 'downloading' | 'ready' | 'failed'
  system: boolean
  /** The installed CLI's version as the version watcher last read it (BTN-603); `null` — none or not read yet. */
  installed?: string | null
  received: number
  total: number
  approximate: number
}
