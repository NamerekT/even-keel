/** Ephemeral copy state shared with the page; no download is started by reading it. */
export interface CliCopyView {
  version: string
  source: 'checked' | 'system'
  status: 'missing' | 'downloading' | 'ready' | 'failed'
  system: boolean
  received: number
  total: number
  approximate: number
}
