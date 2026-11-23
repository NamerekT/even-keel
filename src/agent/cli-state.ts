export type CliSourceName = 'checked' | 'system' | 'latest'
export type CliCopyStatus = 'missing' | 'downloading' | 'ready' | 'failed'

/** Ephemeral copy state shared with the page; no download is started by reading it. */
export interface CliCopyView {
  /** The checked version, Even Keel's copy of which `checked` runs. */
  version: string
  source: CliSourceName
  /** The copy sessions run on: the newest version's on `latest`, the checked one's otherwise. */
  status: CliCopyStatus
  /** The checked copy's, whatever the source. */
  checkedStatus: CliCopyStatus
  /**
   * The version of Even Keel's copy of the newest release (BTN-1539), `null` — none downloaded; absent — the agent has
   * no such copy on this platform.
   */
  latest?: string | null
  /** Whether a person can install the CLI here themselves; `false` (a container, a global npm folder it cannot write) offers `latest`. */
  installable: boolean
  system: boolean
  /** The installed CLI's version as the version watcher last read it (BTN-603); `null` — none or not read yet. */
  installed?: string | null
  received: number
  total: number
  approximate: number
}
