import type { CliCopyView } from './cli-state.js'
import type { PinnedCli } from './pinned.js'

/** Explicit copy operations; probing availability and periodic cleanup never download. */
export function cliCopy(copy: PinnedCli | undefined, options: { checkedCli(): boolean }, version: string, system: () => boolean, overridden: () => boolean, approximate: number, extra?: PinnedCli) {
  /** Spans both packages, so the gap between them does not read as a missing copy and fold the banner away. */
  let downloading = false
  /**
   * The package whose bytes the page shows: the CLI, or the second package when the CLI is already in place. Once it
   * is in, the rest of the run reads as unpacking, so the progress line only goes forward (BTN-681).
   */
  let lead: PinnedCli | undefined
  function bytes(): { received: number; total: number } {
    const { received, total } = (lead ?? copy)?.progress ?? { received: 0, total: 0 }
    if (!downloading || lead?.downloading) return { received, total }
    const whole = total || received
    return { received: whole, total: whole }
  }
  return {
    /** The view without `system`, which searches the disk: what a launch asks before each start. */
    state(): Pick<CliCopyView, 'source' | 'status'> {
      return {
        source: options.checkedCli() && !overridden() ? 'checked' : 'system',
        status: downloading || copy?.downloading || extra?.downloading ? 'downloading' :copy?.error || extra?.error ? 'failed' : copy?.path() !== undefined && (extra === undefined || extra.path() !== undefined) ? 'ready' : 'missing',
      }
    },
    view(): CliCopyView {
      return { version, ...this.state(), system: system(), ...bytes(), approximate }
    },
    async download(): Promise<void> {
      if (!copy) throw new Error('No checked CLI for this platform')
      downloading = true
      lead = copy.path() === undefined ? copy : extra
      try {
        await copy.ensure()
        if (copy.path() !== undefined) await extra?.ensure()
      } finally {
        downloading = false
        lead = undefined
      }
    },
    async prune(): Promise<void> { await copy?.prune(); await extra?.prune() },
    /** The CLI's copy, not the second package: its download is the one consented to. */
    hadCopy: (): boolean => copy?.hadCopy() ?? false,
  }
}
