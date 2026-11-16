import { posix, win32 } from 'node:path'
import { compareVersions, isPrerelease } from './updates/release.js'

export type CliCommand =
  | { command: 'run' | 'install' | 'uninstall' }
  /** `version: null` — none given: `updateTargetOf` picks it from the dist-tags. */
  | { command: 'update'; version: string | null }
  | { command: 'help'; error?: string }
  /** `root: null` — none given: the machine's own folder of projects. */
  | { command: 'join'; line: string; root: string | null }
  | { command: 'status' }

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
  if (name === 'status') return rest.length === 0 ? { command: 'status' } : { command: 'help', error: 'status takes no arguments' }
  if (name === 'join') return joinOf(rest)
  return { command: 'help', error: `unknown command ${name}` }
}

/** `join <connection string> [--root <folder>]`, the option before or after the string. */
function joinOf(rest: string[]): CliCommand {
  const at = rest.indexOf('--root')
  const root = at === -1 ? null : rest[at + 1]
  const lines = at === -1 ? rest : rest.filter((_, index) => index !== at && index !== at + 1)
  if (root === undefined || root?.startsWith('--') === true) return { command: 'help', error: '--root needs a folder' }
  if (lines.length !== 1) return { command: 'help', error: 'join takes one connection string' }
  return { command: 'join', line: lines[0]!, root }
}

/**
 * The exit code of `service/install.sh` that found no service manager to install into (Linux without a systemd user
 * manager): the script has said why and how to run without one, so the CLI passes the code on with no "failed" line.
 */
export const noServiceManagerCode = 3

export function serviceScriptOf(platform: NodeJS.Platform, root: string, action: 'install' | 'uninstall'): [string, string[]] {
  if (platform === 'win32') return ['pwsh', ['-NoProfile', '-File', win32.join(root, 'service', `${action}.ps1`)]]
  return ['/bin/sh', [posix.join(root, 'service', `${action}.sh`)]]
}
