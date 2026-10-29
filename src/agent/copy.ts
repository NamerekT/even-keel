import type { CliCopyView } from './cli-state.js'
import type { PinnedCli } from './pinned.js'

/** Explicit copy operations; probing availability and periodic cleanup never download. */
export function cliCopy(copy: PinnedCli | undefined, options: { checkedCli(): boolean }, version: string, system: () => boolean, overridden: () => boolean, approximate: number, extra?: PinnedCli) {
  return {
    view(): CliCopyView {
      return {
        version, source: options.checkedCli() && !overridden() ? 'checked' : 'system',
        status: copy?.downloading || extra?.downloading ? 'downloading' : copy?.error || extra?.error ? 'failed' : copy?.path() !== undefined && (extra === undefined || extra.path() !== undefined) ? 'ready' : 'missing',
        system: system(), received: (copy?.progress.received ?? 0) + (extra?.progress.received ?? 0), total: (copy?.progress.total ?? 0) + (extra?.progress.total ?? 0), approximate,
      }
    },
    async download(): Promise<void> {
      if (!copy) throw new Error('No checked CLI for this platform')
      await copy.ensure()
      if (copy.path() !== undefined) await extra?.ensure()
    },
    async prune(): Promise<void> { await copy?.prune(); await extra?.prune() },
  }
}
