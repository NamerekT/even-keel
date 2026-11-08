import { isMuslLinux, npmLatest } from '../agent/npm.js'
import { claude } from '../claude/adapter.js'
import { codex } from '../codex/adapter.js'
import { opencode } from '../opencode/adapter.js'
import { openCodePackage } from '../opencode/release.js'

/** The release sources of the installed CLIs; the SDK always runs on checked. */
export function latestTarget(cli: string | undefined): { checked: string; latest(): Promise<string> } {
  if (cli === 'opencode') {
    const name = openCodePackage(process.platform, process.arch, isMuslLinux())
    if (name === null) throw new Error(`OpenCode has no build for ${process.platform}-${process.arch}`)
    return { checked: opencode.checked, latest: () => npmLatest(name) }
  }
  const adapter = cli === 'claude' ? claude : cli === 'codex' ? codex : undefined
  if (adapter?.latest === undefined) throw new Error('cli-latest: expected claude, codex or opencode')
  return { checked: adapter.checked, latest: adapter.latest }
}

/** Publish checked before the network call so a failed discovery can still name it in the job summary. */
export async function resolveLatest(cli: string | undefined, output: (name: string, value: string) => void): Promise<void> {
  const target = latestTarget(cli)
  output('checked', target.checked)
  const latest = await target.latest()
  output('latest', latest)
  output('run', String(latest !== target.checked))
}
