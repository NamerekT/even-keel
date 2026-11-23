import type { CliCopyStatus, CliCopyView, CliSourceName } from './cli-state.js'
import type { LatestCli } from './latest.js'
import type { PinnedCli } from './pinned.js'

export interface CliCopyOptions {
  /** Whether sessions run on one of Even Keel's own copies rather than the installed CLI. */
  checkedCli(): boolean
  /** Optional. Whether that copy is the newest release's (`cli: latest`, BTN-1539) rather than the checked one. */
  latestCli?(): boolean
}

/** The binary of the copy sessions run on; `undefined` — the installed CLI's (`EVEN_KEEL_<AGENT>_BIN` overrides both copies). */
export function ownCopyPath(copy: PinnedCli | undefined, latest: LatestCli | undefined, options: CliCopyOptions, overridden: boolean): string | undefined {
  if (overridden || !options.checkedCli()) return undefined
  return latest !== undefined && options.latestCli?.() === true ? latest.path() : copy?.path()
}

/** Explicit copy operations; probing availability and periodic cleanup never download. */
export function cliCopy(copy: PinnedCli | undefined, options: CliCopyOptions, version: string, system: () => boolean, overridden: () => boolean, approximate: number, extra?: PinnedCli, latest?: LatestCli) {
  /** Spans both packages, so the gap between them does not read as a missing copy and fold the banner away. */
  let downloading = false
  /**
   * The package whose bytes the page shows: the CLI, or the second package when the CLI is already in place. Once it
   * is in, the rest of the run reads as unpacking, so the progress line only goes forward (BTN-681).
   */
  let lead: PinnedCli | undefined
  function bytes(): { received: number; total: number } {
    if (source() === 'latest') return latest!.progress
    const { received, total } = (lead ?? copy)?.progress ?? { received: 0, total: 0 }
    if (!downloading || lead?.downloading) return { received, total }
    const whole = total || received
    return { received: whole, total: whole }
  }
  function source(): CliSourceName {
    if (!options.checkedCli() || overridden()) return 'system'
    return latest !== undefined && options.latestCli?.() === true ? 'latest' : 'checked'
  }
  function checkedStatus(): CliCopyStatus {
    return downloading || copy?.downloading || extra?.downloading ? 'downloading' : copy?.error || extra?.error ? 'failed' : copy?.path() !== undefined && (extra === undefined || extra.path() !== undefined) ? 'ready' : 'missing'
  }
  function latestStatus(): CliCopyStatus {
    return latest!.downloading ? 'downloading' : latest!.error ? 'failed' : latest!.path() !== undefined ? 'ready' : 'missing'
  }
  return {
    /** The view without `system`, which searches the disk: what a launch asks before each start. */
    state(): Pick<CliCopyView, 'source' | 'status'> {
      const current = source()
      return { source: current, status: current === 'latest' ? latestStatus() : checkedStatus() }
    },
    view(): Omit<CliCopyView, 'installable'> {
      return { version, ...this.state(), checkedStatus: checkedStatus(), ...(latest === undefined ? {} : { latest: latest.version() }), system: system(), ...bytes(), approximate }
    },
    /** The copy of the current source; on `latest` a newer release too, when the registry has one. */
    async download(): Promise<void> {
      if (source() === 'latest') return latest!.ensure()
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
    /** On the version sweep: a ready copy of the newest release looks for a newer one in the background, never a first download. */
    update(): void {
      if (source() === 'latest' && latest!.path() !== undefined) void latest!.ensure()
    },
    async prune(): Promise<void> { await copy?.prune(); await extra?.prune(); await latest?.prune() },
    /** The CLI's copies, not the second package: their download is the one consented to. */
    hadCopy: (): boolean => (copy?.hadCopy() ?? false) || (latest?.hadCopy() ?? false),
  }
}
