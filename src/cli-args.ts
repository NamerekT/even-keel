import { posix, win32 } from 'node:path'
import { compareVersions, isPrerelease } from './updates/release.js'

/** A machine of a hub to install (BTN-1243): `root: null` — none given, the machine's own folder of projects. */
export interface MachineJoin {
  line: string
  root: string | null
}

/** `machine: null` — the hub with its own machine, as every install before BTN-1243; `service` — the Windows service. */
export interface InstallOptions {
  machine: MachineJoin | null
  service: boolean
}

export type CliCommand =
  | { command: 'run' | 'uninstall' }
  | ({ command: 'install' } & InstallOptions)
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
  if (name === 'install') return installOf(rest)
  if (name === 'uninstall') return rest.length === 0 ? { command: name } : { command: 'help', error: `${name} takes no arguments` }
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

/** `install [--machine <string> [--root <folder>]] [--service]`, the options in any order. */
function installOf(rest: string[]): CliCommand {
  let line: string | null = null
  let root: string | null = null
  let service = false
  for (let at = 0; at < rest.length; at++) {
    const option = rest[at]
    if (option === '--service') service = true
    else if (option === '--machine' || option === '--root') {
      const value = rest[at + 1]
      if (value === undefined || value.startsWith('--')) {
        return { command: 'help', error: option === '--machine' ? '--machine needs the connection string the hub issued' : '--root needs a folder' }
      }
      if ((option === '--machine' ? line : root) !== null) return { command: 'help', error: `${option} is given twice` }
      if (option === '--machine') line = value
      else root = value
      at++
    } else return { command: 'help', error: 'install takes only --machine <string>, --root <folder> and --service' }
  }
  if (line === null && root !== null) return { command: 'help', error: '--root is the folder of projects of a machine: give --machine <string> too' }
  return { command: 'install', machine: line === null ? null : { line, root }, service }
}

/** The options of `install` again, for the global copy the npx one hands the install to. */
export function installArgsOf({ machine, service }: InstallOptions): string[] {
  const args = machine === null ? [] : ['--machine', machine.line, ...(machine.root === null ? [] : ['--root', machine.root])]
  return service ? [...args, '--service'] : args
}

/**
 * The exit code of `service/install.sh` that found no service manager to install into (Linux without a systemd user
 * manager): the script has said why and how to run without one, so the CLI passes the code on with no "failed" line.
 */
export const noServiceManagerCode = 3

/**
 * The script and its arguments; a machine to install goes as `-Machine`/`-Projects` to PowerShell (a `-Root` would be the
 * script's own `$root`: PowerShell's names ignore case), `--machine`/`--root` to sh.
 */
export function serviceScriptOf(platform: NodeJS.Platform, root: string, action: 'install' | 'uninstall', machine: MachineJoin | null = null): [string, string[]] {
  const windows = platform === 'win32'
  const join = machine === null ? [] : [windows ? '-Machine' : '--machine', machine.line, ...(machine.root === null ? [] : [windows ? '-Projects' : '--root', machine.root])]
  if (windows) return ['pwsh', ['-NoProfile', '-File', win32.join(root, 'service', `${action}.ps1`), ...join]]
  return ['/bin/sh', [posix.join(root, 'service', `${action}.sh`), ...join]]
}
