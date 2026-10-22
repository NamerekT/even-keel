import { posix, win32 } from 'node:path'

export type CliCommand =
  | { command: 'run' | 'install' | 'uninstall' }
  | { command: 'update'; version: string }
  | { command: 'help'; error?: string }

/** The `even-keel` command line: none — run in the foreground; `install`/`uninstall` — the service; `update [version]`. */
export function commandOf(argv: string[]): CliCommand {
  const [name, ...rest] = argv
  if (name === undefined) return { command: 'run' }
  if (name === 'help' || name === '--help' || name === '-h') return { command: 'help' }
  if (name === 'install' || name === 'uninstall') return rest.length === 0 ? { command: name } : { command: 'help', error: `${name} takes no arguments` }
  if (name === 'update') return rest.length <= 1 ? { command: 'update', version: rest[0] ?? 'latest' } : { command: 'help', error: 'update takes one version at most' }
  return { command: 'help', error: `unknown command ${name}` }
}

export function serviceScriptOf(platform: NodeJS.Platform, root: string, action: 'install' | 'uninstall'): [string, string[]] {
  if (platform === 'win32') return ['pwsh', ['-NoProfile', '-File', win32.join(root, 'service', `${action}.ps1`)]]
  return ['/bin/sh', [posix.join(root, 'service', `${action}.sh`)]]
}
