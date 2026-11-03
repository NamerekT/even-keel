import { posix, win32 } from 'node:path'
import { compareVersions, isPrerelease } from './updates/release.js'

export type CliCommand =
  | { command: 'run' | 'install' | 'uninstall' }
  /** `version: null` — none given: `updateTargetOf` picks it from the dist-tags. */
  | { command: 'update'; version: string | null }
  | { command: 'help'; error?: string }

/**
 * The version a bare `even-keel update` installs: the newest of `latest` and, for an installed prerelease, `next`
 * (`latest` may be older than a release candidate); `null` when none is newer than the installed one.
 */
export function updateTargetOf(installed: string, tags: Readonly<Record<string, unknown>>): string | null {
  const names = isPrerelease(installed) ? ['latest', 'next'] : ['latest']
  let best: string | null = null
  for (const name of names) {
    const tag = tags[name]
    if (typeof tag !== 'string' || compareVersions(tag, installed) === null) continue
    if (best === null || compareVersions(tag, best)! > 0) best = tag
  }
  return best !== null && compareVersions(best, installed)! > 0 ? best : null
}

/** The `even-keel` command line: none — run in the foreground; `install`/`uninstall` — the service; `update [version]`. */
export function commandOf(argv: string[]): CliCommand {
  const [name, ...rest] = argv
  if (name === undefined) return { command: 'run' }
  if (name === 'help' || name === '--help' || name === '-h') return { command: 'help' }
  if (name === 'install' || name === 'uninstall') return rest.length === 0 ? { command: name } : { command: 'help', error: `${name} takes no arguments` }
  if (name === 'update') return rest.length <= 1 ? { command: 'update', version: rest[0] ?? null } : { command: 'help', error: 'update takes one version at most' }
  return { command: 'help', error: `unknown command ${name}` }
}

export function serviceScriptOf(platform: NodeJS.Platform, root: string, action: 'install' | 'uninstall'): [string, string[]] {
  if (platform === 'win32') return ['pwsh', ['-NoProfile', '-File', win32.join(root, 'service', `${action}.ps1`)]]
  return ['/bin/sh', [posix.join(root, 'service', `${action}.sh`)]]
}
